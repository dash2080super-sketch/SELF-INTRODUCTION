/**
 * 波段工作台的取数层： code 归一化 → 东财行情 → 与 watch 表合并成「带信号的行」。
 *
 * 为什么小数位必须动态换算（踩过的坑）：
 *   东财 push2 返回的价格是整数，真实价格 = raw / (10 ** f59)，而 f59 每个标的不一样：
 *   A 股多为 2（贵州茅台 raw 125574 → 1255.74），
 *   ETF 与港股多为 3（腾讯 raw 454600 → 454.6，日经ETF raw 2155 → 2.155）。
 *   硬编码 /1000 会把 ETF 和 A 股全算错一个数量级，而且错得很「像真的」。
 *
 * 为什么不用 reddit 上常见的 ulist.np 直接出价：
 *   ulist.np 返回的 f59 是脏数据（实测返回的像是别的含义，比如 81.29 / 64.04），
 *   只有单股接口 stock/get 的 f59 可信。
 *   所以策略是：**小数位只在「首次见到这只标的」时用单股接口取一次并落库**，
 *   之后每次刷新都走批量接口（一次请求拉全部，实测 20 只约 4 秒，与标的数无关）。
 */
import { getDB } from './db.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/*
 * 东财的行情主机有一个坑：这台 VPS 在新加坡（海外 IP），
 * 访问 push2.eastmoney.com 会被 302 到 push2delay.eastmoney.com（延时节点）再返回数据，
 * 有时 Node 的 fetch 跟跳转时会直接报 "fetch failed"，整页变成「无行情」。
 * 实测直接打延时节点是稳的：5/5 成功，每次约 2 秒，比绕跳转还快一倍。
 * 所以：延时节点优先，push2 当备用。
 */
const EM_HOSTS = ['https://push2delay.eastmoney.com', 'https://push2.eastmoney.com'];
const EM_QUOTE_PATH = '/api/qt/stock/get';
const EM_BATCH_PATH = '/api/qt/ulist.np/get';
const EM_SUGGEST = 'https://searchapi.eastmoney.com/api/suggest/get';

const TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 25_000;      // 同一时刻重复请求的合并窗口
const WARM_INTERVAL_MS = 60_000;  // 后台预热周期
const IDLE_STOP_MS = 10 * 60_000; // 没人看这么久就停掉预热

let cache = { at: 0, key: '', body: null, inflight: null };
let warmTimer = null;
let lastAccessAt = 0;

/* ---------------- code → secid ---------------- */

/**
 * 把用户的随意输入变成东财 secid。容错范围尽量宽：
 *   600519 / sh600519 / 600519.SH → 1.600519
 *   000858 / sz000858             → 0.000858
 *   300750                        → 0.300750
 *   700 / 0700 / 00700 / 700.HK / hk00700 → 116.00700
 * 判断不出来的返回 null，由调用方提示用户手填。
 */
export function normalizeSecid(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const digitGroups = s.match(/\d+/g);
  if (!digitGroups) return null;
  const digits = digitGroups.join('');
  if (!digits) return null;

  // 港股：显式写了 hk，或者位数不足 6 位（港股习惯简写 700 / 0700）
  const wantsHK = s.includes('hk') || digits.length < 6;
  if (wantsHK) {
    const code = digits.replace(/^0+(?=\d)/, '').padStart(5, '0').slice(-5);
    if (!code || code === '00000') return null;
    return { secid: `116.${code}`, market: 'H', code };
  }

  const code = digits.padStart(6, '0').slice(-6);
  const head = code[0];
  // 东财：市场号 1=沪，0=深（北交所也挂在 0 下）
  //   沪：6/9 开头的主板、科创板 688、以及 5 开头的沪市 ETF/LOF（51xxxx、58xxxx）
  //   深：0/3 开头的股票，以及 1 开头的深市 ETF/LOF（15xxxx、16xxxx）
  //   北交所：4 / 8 开头
  const sh = head === '6' || head === '9' || head === '5';
  return { secid: `${sh ? 1 : 0}.${code}`, market: 'A', code };
}

/* ---------------- 网络 ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' },
      signal: ac.signal,
      redirect: 'follow',
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 按 EM_HOSTS 顺序试，谁先回就用谁；全挂就抛最后一个错误。 */
async function getJSON(path, search) {
  let lastErr = null;
  for (const host of EM_HOSTS) {
    try {
      return await once(`${host}${path}?${search}`);
    } catch (e) {
      lastErr = e;
      await sleep(300);
    }
  }
  throw lastErr || new Error('行情接口全部不可用');
}

/** 单股：唯一能拿到可信 f59（小数位）的接口，只在新增标的时调用一次 */
export async function fetchOne(secid) {
  const j = await getJSON(
    EM_QUOTE_PATH,
    `secid=${encodeURIComponent(secid)}&fields=f43,f57,f58,f59,f60,f169,f170`
  );
  const d = j && j.data;
  if (!d || d.f43 == null) return null;
  const dec = Number.isInteger(d.f59) ? d.f59 : 2;
  const div = 10 ** dec;
  return {
    secid,
    name: String(d.f58 || '').replace(/\s+/g, ''),
    decimals: dec,
    price: d.f43 / div,
    prevClose: d.f60 == null ? null : d.f60 / div,
  };
}

/** 批量：一次请求拿全部价格。注意它不带可用小数位，所以必须靠库里的 decimals */
async function fetchBatch(secids) {
  if (!secids.length) return new Map();
  const j = await getJSON(
    EM_BATCH_PATH,
    `secids=${encodeURIComponent(secids.join(','))}&fields=f12,f13,f14,f2,f3,f18,f4,f6`
  );
  const diff = (j && j.data && j.data.diff) || [];
  const out = new Map();
  for (const it of diff) {
    const mk = it.f13;
    const code = it.f12;
    if (mk == null || code == null) continue;
    out.set(`${mk}.${code}`, {
      rawPrice: it.f2,
      rawPrev: it.f18,
      rawAmount: it.f6,
      nameRaw: String(it.f14 || '').replace(/\s+/g, ''),
    });
  }
  return out;
}

/** 代码输错了仍想救：用东财搜索联想取第一个候选 */
async function suggest(code) {
  try {
    const j = await once(
      `${EM_SUGGEST}?input=${encodeURIComponent(code)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=5`
    );
    const items = (j && j.QuotationCodeTable && j.QuotationCodeTable.Data) || [];
    if (!items.length) return null;
    const it = items[0];
    if (it.MktNum == null || !it.Code) return null;
    return { secid: `${it.MktNum}.${it.Code}`, market: Number(it.MktNum) === 116 ? 'H' : 'A', code: String(it.Code), name: it.Name };
  } catch {
    return null;
  }
}

/* ---------------- watch 表读写 ---------------- */

function listWatch(db) {
  return db.prepare('SELECT * FROM swing_watch WHERE enabled = 1 ORDER BY sort DESC, id ASC').all();
}

function saveDerived(db, id, patch) {
  const sets = [];
  const args = [];
  for (const [k, v] of Object.entries(patch)) {
    if (['name', 'decimals', 'secid', 'market'].includes(k)) {
      sets.push(`${k} = ?`);
      args.push(v);
    }
  }
  if (!sets.length) return;
  args.push(id);
  db.prepare(`UPDATE swing_watch SET ${sets.join(', ')} WHERE id = ?`).run(...args);
}

/* ---------------- 快照：watch + 行情 + 信号 ---------------- */

function signalOf(row, price) {
  const buy = Number(row.buy_price) || 0;
  const sell = Number(row.sell_price) || 0;
  let signal = 'hold';
  let tone = null; // 命中时才返回颜色，其余交给前端用默认样式

  // 没有价格时一律不判断。JS 里 `null <= 420` 是 true —— 不拦住的话，
  // 行情一断，整屏会齐刷刷变成「到买点」，那是会让人真下单的那种假信号。
  if (price != null && Number.isFinite(price)) {
    if (buy > 0 && price <= buy) {
      signal = 'buy';
      tone = row.buy_color || 'pink';
    } else if (sell > 0 && price >= sell) {
      signal = 'sell';
      tone = row.sell_color || 'red';
    }
  }
  const distBuy = buy > 0 && price ? Math.round(((price - buy) / buy) * 10000) / 100 : null;
  const distSell = sell > 0 && price ? Math.round(((sell - price) / sell) * 10000) / 100 : null;
  return { signal, tone, distBuy, distSell };
}

async function buildSnapshot() {
  const db = getDB();
  const rows = listWatch(db);
  if (!rows.length) {
    return { items: [], fetchedAt: new Date().toISOString(), stale: false, count: 0 };
  }

  // decimals 记 0 = 「还没打听过」。不猜，一猜就可能把港股 454.6 算成 45.46 这种量级错误。
  const need = rows.filter((r) => !(Number(r.decimals) > 0) || !r.name);
  const done = rows.filter((r) => !need.includes(r));

  // 1) 新标的补一次单股，拿小数位和名称
  let enrichErrors = 0;
  if (need.length) {
    const got = await Promise.all(need.map((r) => fetchOne(r.secid).catch(() => null)));
    for (let i = 0; i < need.length; i++) {
      const r = need[i];
      const g = got[i];
      if (g && Number.isFinite(g.price)) {
        saveDerived(db, r.id, { name: g.name, decimals: g.decimals });
        need[i] = { ...r, name: g.name, decimals: g.decimals };
      } else {
        const sg = await suggest(r.code).catch(() => null);
        if (sg) {
          saveDerived(db, r.id, { secid: sg.secid, market: sg.market, name: sg.name });
          const g2 = await fetchOne(sg.secid).catch(() => null);
          if (g2) {
            saveDerived(db, r.id, { decimals: g2.decimals, name: g2.name });
            need[i] = { ...r, secid: sg.secid, market: sg.market, name: g2.name, decimals: g2.decimals };
          } else {
            enrichErrors++;
          }
        } else {
          enrichErrors++;
        }
      }
    }
  }

  const all = done.concat(need);

  // 2) 批量拉价（去重）
  const secids = [...new Set(all.map((r) => r.secid).filter(Boolean))];
  let quotes = new Map();
  let quoteError = null;
  try {
    quotes = await fetchBatch(secids);
  } catch (e) {
    quoteError = e.message;
  }

  // 拉价失败时，退回上一次的价格，别让页面一会儿有价一会儿空白。
  // （价格只是「旧」，比显示「无行情」有用得多；前端会把它标成 stale。）
  const staleMap = new Map();
  if (quoteError && cache.body && cache.body.items) {
    for (const it of cache.body.items) {
      if (it.price != null) staleMap.set(it.secid, it);
    }
  }

  // 3) 合并
  const items = all.map((r) => {
    const q = quotes.get(r.secid);
    const old = q ? null : staleMap.get(r.secid);
    const dec = Number(r.decimals) > 0 ? Number(r.decimals) : 2; // 兜底仅用于「还没拿过小数位」这一瞬
    const div = 10 ** dec;
    const has = q && q.rawPrice != null;
    const price = has ? q.rawPrice / div : old ? old.price : null;
    const prev = has && q.rawPrev != null ? q.rawPrev / div : old ? old.prevClose : null;
    const pct = old && !has ? old.pct : price != null && prev ? ((price - prev) / prev) * 100 : null;
      const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
      const base = {
        id: r.id,
        code: r.code,
        secid: r.secid,
        market: r.market,
        name: r.name || '',
        buy_price: Number(r.buy_price) || 0,
        sell_price: Number(r.sell_price) || 0,
        buy_color: r.buy_color || 'pink',
        sell_color: r.sell_color || 'red',
        note: r.note || '',
        sort: r.sort || 0,
        price: r3(price),
        prevClose: r3(prev),
        pct: r3(pct),
        amount: (has && q && q.rawAmount != null) ? q.rawAmount : old ? old.amount : null,
        live: has,
        stale: !has && !!old,
      };
    return { ...base, ...signalOf(base, price) };
  });

  return {
    items,
    fetchedAt: new Date().toISOString(),
    stale: !!quoteError,
    error: quoteError || (enrichErrors ? `${enrichErrors} 只标的代码查不到行情` : null),
    count: items.length,
  };
}

/* ---------------- 对外：带缓存与后台预热 ---------------- */

export async function getSnapshot(force = false) {
  lastAccessAt = Date.now();
  const age = Date.now() - cache.at;
  if (!force && cache.body && age < CACHE_TTL_MS) return cache.body;

  // 同一窗口内的重复请求合并成一个，避免并发打爆上游
  if (cache.inflight) return cache.inflight;

  cache.inflight = buildSnapshot()
    .then((body) => {
      cache = { at: Date.now(), body, inflight: null };
      return body;
    })
    .catch((e) => {
      cache.inflight = null;
      throw e;
    });
  return cache.inflight;
}

/**
 * 后台预热：页面开着时（近 10 分钟有人请求过）每 60 秒拉一次。
 * 这样前端点进 tab 或轮询时几乎总是命中新鲜缓存，不用干等东财那 4 秒。
 * 页面关了就自然停 —— 不浪费 VPS 那点可怜的资源。
 */
export function startWarmer() {
  if (warmTimer) return;
  warmTimer = setInterval(async () => {
    try {
      // 先看有没有人在看；超过 10 分钟没人请求就跳过这一轮。
      // 注意这里不能直接调 getSnapshot —— 那会刷新最后访问时间，导致预热自己喂自己、永远不停。
      if (Date.now() - lastAccessAt > IDLE_STOP_MS) return;
      const body = await buildSnapshot();
      cache = { at: Date.now(), body, inflight: null };
    } catch {
      /* 预热失败无所谓，下一次再试 */
    }
  }, WARM_INTERVAL_MS);
  warmTimer.unref?.();
}

export function stopWarmer() {
  if (warmTimer) clearInterval(warmTimer);
  warmTimer = null;
}

export const __debug = { normalizeSecid, fetchOne, fetchBatch, suggest, buildSnapshot };
