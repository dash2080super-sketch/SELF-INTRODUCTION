/**
 * finance 看板取数器（分级 + 自适应）。
 *
 * 改之前先读完这段，不然很容易把 512MB 的小机器拖垮，或者被上游限流：
 *
 * 1) 分级。指标在 finance-catalog.js 里标了 tier：
 *      fast  —— 期货、股指现货、汇率、金银油，约 20 秒刷一次
 *      slow  —— 收益率、波动率家族、全球股指、个股，约 120 秒
 *      daily —— CNN 恐惧贪婪（本身日更）、手动录入项，不常刷
 *    每轮只拉"该更新的那部分"，不是每次全量重刷 30 个标的。
 *
 * 2) 自适应。记录最后一次客户端请求时间 lastClientAt。
 *    有人在看（90 秒内来过请求）→ 全速；没人看 → 间隔放大 9 倍。
 *    更关键的是：**刷新只在客户端请求时触发**。你关了页面，
 *    服务端一个上游请求都不会发，开销是 0，不是"慢速刷新"。
 *
 * 3) 失败保留旧值。上游抖一下就把数字清空，看板会闪，比显示旧值更糟。
 *    每条腿独立缓存，失败就用上一次的值。
 *
 * 4) 请求合并。同一时刻的多个客户端请求共用一个 inFlight Promise，
 *    多开标签页不会把上游请求翻倍。
 *
 * 5) 每日预算。DAY_BUDGET 是保险丝，防"标签页开着忘了关跑一星期"。
 *
 * 源策略：每条腿声明 cnbc / yahoo / tv 三个候选。先走 CNBC 批量（一次 8 个符号），
 * 拿不到或变化为 UNCH 才回落 Yahoo 单查；CNBC、Yahoo 都没有的期货腿（DAX、TOPIX）
 * 走 tv（TradingView 公开端点，约 15 分钟延迟）。单个源挂掉只降级，不会整片空白。
 */
import { ZONES, ITEMS, MANUAL_IDS } from './finance-catalog.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const CNBC_BATCH = 8;
const YAHOO_CONCURRENCY = 6;
const TV_CONCURRENCY = 4;
const IDLE_AFTER = 90_000;

// 每日上游请求上限。正常使用远远够（盯着看一整天也才 2.5 万次）。
// 这道闸只为防"标签页开着忘了关，连着跑一星期"——真被限流了整个看板会瞎。
const DAY_BUDGET = 60_000;

const TTL = {
  fast: { active: 20_000, idle: 180_000 },
  slow: { active: 120_000, idle: 600_000 },
  daily: { active: 900_000, idle: 1_800_000 },
};

/* ---------------- 运行时状态 ---------------- */
const store = new Map(); // legKey -> { quote, at }
let cnnValue = null; // { quote, at }
let lastClientAt = 0;
let inFlight = null;

export const stats = {
  mode: 'idle',
  cycles: 0,
  requests: 0,
  errors: 0,
  lastCycleMs: 0,
  lastRefreshAt: null,
  fastAge: null,
  slowAge: null,
  day: '',
  dayRequests: 0,
  budgetHit: false,
};

const todayKey = () => new Date().toISOString().slice(0, 10);

function rollDayIfNeeded() {
  const day = todayKey();
  if (stats.day !== day) {
    stats.day = day;
    stats.dayRequests = 0;
    stats.budgetHit = false;
  }
}

function countRequest() {
  rollDayIfNeeded();
  stats.requests++;
  stats.dayRequests++;
  if (stats.dayRequests > DAY_BUDGET && !stats.budgetHit) {
    stats.budgetHit = true;
    console.warn(`[finance] 当日上游请求超过 ${DAY_BUDGET} 次，今天强制进入省电模式`);
  }
}

/** 当前该跑什么模式 */
function currentMode() {
  rollDayIfNeeded();
  if (stats.budgetHit) return 'idle';
  return Date.now() - lastClientAt < IDLE_AFTER ? 'active' : 'idle';
}

/** 给 /stats 用的实时模式（刷新只在客户端请求时触发，
 *  所以光靠 stats.mode 会停留在上一次刷新时的值） */
export function modeNow() {
  stats.mode = currentMode();
  return stats.mode;
}

const legKey = (itemId, label) => `${itemId} ${label}`;

function tierOf(item) {
  if (item.manual) return 'daily';
  if (item.provider === 'cnn') return 'daily';
  return item.tier === 'fast' ? 'fast' : 'slow';
}

function allLegs() {
  const out = [];
  for (const it of ITEMS.values()) {
    for (const leg of it.legs || []) {
      out.push({
        key: legKey(it.id, leg.label),
        id: it.id,
        tier: tierOf(it),
        cnbc: leg.cnbc || null,
        yahoo: leg.yahoo || null,
        tv: leg.tv || null,
      });
    }
  }
  return out;
}

const num = (s) => {
  if (s == null) return null;
  const v = parseFloat(String(s).replace(/[,%+$\s]/g, ''));
  return Number.isFinite(v) ? v : null;
};
const pct = (a, b) => (a != null && b != null && b !== 0 ? ((a - b) / b) * 100 : null);

async function getJSON(url, headers = {}, ms = 10_000) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/* ---------------- CNBC 批量 ---------------- */
async function fetchCnbc(symbols) {
  const out = new Map();
  for (let i = 0; i < symbols.length; i += CNBC_BATCH) {
    const batch = symbols.slice(i, i + CNBC_BATCH);
    const url =
      'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol' +
      `?symbols=${encodeURIComponent(batch.join('|'))}&requestMethod=itv&noform=1&partnerId=2&output=json`;
    countRequest();
    try {
      const j = await getJSON(url);
      for (const q of [].concat(j?.FormattedQuoteResult?.FormattedQuote || [])) {
        if (String(q.code) !== '0') continue;
        const price = num(q.last);
        if (price == null) continue;
        const raw = String(q.change_pct || '');
        const chgPct = raw === 'UNCH' ? null : num(raw);
        out.set(q.symbol, {
          price,
          chg: chgPct == null ? null : num(q.change),
          chgPct,
          name: q.name || '',
          time: q.last_time || null,
          src: 'cnbc',
          at: Date.now(),
        });
      }
    } catch (e) {
      stats.errors++;
      console.warn('[finance] cnbc 批量失败:', e.message);
    }
  }
  return out;
}

/* ---------------- Yahoo 单查 ---------------- */
async function fetchYahoo(symbol) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    '?range=5d&interval=1d&includePrePost=false';
  countRequest();
  const j = await getJSON(url);
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error('no result');
  const meta = res.meta || {};
  const closes = (res.indicators?.quote?.[0]?.close || []).filter((v) => v != null && Number.isFinite(v));
  const price = meta.regularMarketPrice ?? closes.at(-1) ?? null;
  // 昨收用收盘序列的倒数第二个；不要用 meta.chartPreviousClose
  // （那是"图表窗口开始前"的收盘价，期货还会串到旧合约，会算出荒谬涨跌幅）
  const prev = closes.length >= 2 ? closes.at(-2) : (meta.chartPreviousClose ?? null);
  return {
    price,
    chg: price != null && prev != null ? price - prev : null,
    chgPct: pct(price, prev),
    name: meta.symbol || symbol,
    time: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    src: 'yahoo',
    at: Date.now(),
  };
}

/* ---------------- TradingView 公开端点（期货兜底） ---------------- */
// CNBC / Yahoo 都没有 DAX、TOPIX 期货，只有这里拿得到。
// 返回的是延迟数据（update_mode = delayed_streaming_900，约 15 分钟），
// 判断隔夜欧洲 / 日本盘的方向够用，别拿它做交易触发。
async function fetchTradingView(symbol) {
  const url =
    `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(symbol)}` +
    '&fields=close,change,currency,description,update_mode&no_404=true';
  countRequest();
  const j = await getJSON(url);
  const price = num(j?.close);
  if (price == null) throw new Error('no close');
  const chgPct = num(j?.change);
  // change 本身就是百分比，反推昨收再算绝对变化
  const prev = chgPct != null && chgPct !== -100 ? price / (1 + chgPct / 100) : null;
  return {
    price,
    chg: prev != null ? price - prev : null,
    chgPct,
    name: j?.description || symbol,
    time: null,
    src: 'tv',
    at: Date.now(),
  };
}

async function mapLimit(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const job = queue.shift();
      if (!job) return;
      await worker(job);
    }
  });
  await Promise.all(runners);
}

/* ---------------- CNN 恐惧贪婪 ---------------- */
async function fetchCnn() {
  const url = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
  countRequest();
  const j = await getJSON(url, { Referer: 'https://www.cnn.com/markets/fear-and-greed' });
  const g = j?.fear_and_greed;
  if (!g || g.score == null) throw new Error('no score');
  return {
    price: num(g.score),
    chg: pct(num(g.score), num(g.previous_close)),
    chgPct: pct(num(g.score), num(g.previous_close)),
    name: 'Fear & Greed',
    time: g.timestamp || null,
    src: 'cnn',
    at: Date.now(),
  };
}

/* ---------------- 一轮刷新 ---------------- */
async function refresh(force) {
  const now = Date.now();
  const mode = currentMode();
  stats.mode = mode;

  const legs = allLegs();
  const stale = legs.filter((l) => {
    if (force) return true;
    const cur = store.get(l.key);
    if (!cur) return true;
    return now - cur.at > TTL[l.tier][mode];
  });

  const cnnStale = force || !cnnValue || now - cnnValue.at > TTL.daily[mode];
  if (!stale.length && !cnnStale) return; // 全都还新鲜，一个请求都不发

  // 1) CNBC 批量
  const cnbcSyms = [...new Set(stale.map((l) => l.cnbc).filter(Boolean))];
  const cnbcMap = cnbcSyms.length ? await fetchCnbc(cnbcSyms) : new Map();

  // 2) 需要回落 Yahoo 的腿（CNBC 没拿到，或变化是 UNCH）
  const needYahoo = [];
  const seen = new Set();
  for (const l of stale) {
    const got = l.cnbc ? cnbcMap.get(l.cnbc) : null;
    const usable = got && got.chgPct != null;
    if (!usable && l.yahoo && !seen.has(l.yahoo)) {
      seen.add(l.yahoo);
      needYahoo.push(l.yahoo);
    }
  }
  const yahooMap = new Map();
  await mapLimit(needYahoo, YAHOO_CONCURRENCY, async (symbol) => {
    try {
      yahooMap.set(symbol, await fetchYahoo(symbol));
    } catch (e) {
      stats.errors++;
      console.warn(`[finance] yahoo ${symbol} 失败: ${e.message}`);
    }
  });

  // 3) TradingView 兜底：只给 CNBC / Yahoo 都拿不到的腿（目前是 DAX、TOPIX 期货）
  const needTv = [];
  const seenTv = new Set();
  for (const l of stale) {
    if (!l.tv || seenTv.has(l.tv)) continue;
    const c0 = l.cnbc ? cnbcMap.get(l.cnbc) : null;
    const y0 = l.yahoo ? yahooMap.get(l.yahoo) : null;
    if ((c0 && c0.chgPct != null) || y0) continue;
    seenTv.add(l.tv);
    needTv.push(l.tv);
  }
  const tvMap = new Map();
  await mapLimit(needTv, TV_CONCURRENCY, async (symbol) => {
    try {
      tvMap.set(symbol, await fetchTradingView(symbol));
    } catch (e) {
      stats.errors++;
      console.warn(`[finance] tv ${symbol} 失败: ${e.message}`);
    }
  });

  // 4) 写回。失败就保留旧值，绝不清空。
  for (const l of stale) {
    const c = l.cnbc ? cnbcMap.get(l.cnbc) : null;
    const y = l.yahoo ? yahooMap.get(l.yahoo) : null;
    const t = l.tv ? tvMap.get(l.tv) : null;
    const pick = c && c.chgPct != null ? c : y || t || c || null;
    if (pick) store.set(l.key, { quote: pick, at: Date.now() });
    // pick 为 null 时什么都不做 —— 旧值继续留在 store 里
  }

  // 5) CNN
  if (cnnStale) {
    try {
      cnnValue = { quote: await fetchCnn(), at: Date.now() };
    } catch (e) {
      stats.errors++;
      console.warn('[finance] cnn 失败:', e.message);
    }
  }

  stats.cycles++;
  stats.lastRefreshAt = new Date().toISOString();
}

/* ---------------- 组装 ---------------- */
function compose(db) {
  const manual = readManual(db);
  const now = Date.now();
  let fastAge = null;
  let slowAge = null;

  const zones = ZONES.map((z) => ({
    id: z.id,
    name: z.name,
    icon: z.icon,
    desc: z.desc,
    items: z.items.map((it) => {
      const legs = {};
      let itemAge = null;

      for (const leg of it.legs || []) {
        const rec = store.get(legKey(it.id, leg.label));
        if (rec) {
          legs[leg.label] = rec.quote;
          itemAge = itemAge == null ? now - rec.at : Math.min(itemAge, now - rec.at);
        }
      }

      // 派生比价：把两条腿合成一个"展示腿"（分子 ÷ 分母 × scale）。
      // 涨跌幅用两边各自涨跌幅相减近似 —— 一阶就够精确，日内 <1% 的波动下误差可忽略。
      // 取不到分母时什么都不做，自然退回显示原始两条腿。
      if (it.ratio) {
        const num = legs[it.ratio.num];
        const den = legs[it.ratio.den];
        if (num && den && num.price != null && den.price) {
          const scale = it.ratio.scale || 1;
          const price = (num.price / den.price) * scale;
          const chgPct = num.chgPct != null && den.chgPct != null ? num.chgPct - den.chgPct : null;
          const prev = chgPct != null && chgPct !== -100 ? price / (1 + chgPct / 100) : null;
          for (const k of Object.keys(legs)) delete legs[k];
          legs[it.ratio.label || '比值'] = {
            price,
            chg: prev != null ? price - prev : null,
            chgPct,
            name: it.en || it.name,
            time: num.time || null,
            src: 'derived',
            at: Math.max(num.at || 0, den.at || 0),
          };
        }
      }

      const tier = tierOf(it);
      if (itemAge != null) {
        if (tier === 'fast') fastAge = fastAge == null ? itemAge : Math.min(fastAge, itemAge);
        if (tier === 'slow') slowAge = slowAge == null ? itemAge : Math.min(slowAge, itemAge);
      }

      if (it.provider === 'cnn' && cnnValue) legs._ = cnnValue.quote;

      return {
        id: it.id,
        name: it.name,
        en: it.en,
        dec: it.dec,
        unit: it.unit,
        dir: it.dir,
        bands: it.bands,
        note: it.note,
        srcNote: it.srcNote,
        tier,
        age: itemAge,
        manual: it.manual || null,
        legs,
        manualValue: manual[it.id] || null,
      };
    }),
  }));

  stats.fastAge = fastAge;
  stats.slowAge = slowAge;

  return {
    at: new Date().toISOString(),
    zones,
    meta: {
      mode: stats.mode,
      fastAge,
      slowAge,
      cycles: stats.cycles,
      requests: stats.requests,
      errors: stats.errors,
      dayRequests: stats.dayRequests,
      budgetHit: stats.budgetHit,
      lastRefreshAt: stats.lastRefreshAt,
      lastCycleMs: stats.lastCycleMs,
    },
  };
}

/* ---------------- 对外 ---------------- */
export async function getFinance(db, force = false) {
  lastClientAt = Date.now();

  // 请求合并：同一时刻多个客户端共用一个刷新
  if (!inFlight) {
    const t0 = Date.now();
    inFlight = refresh(force)
      .catch((e) => {
        stats.errors++;
        console.error('[finance] 刷新异常:', e.message);
      })
      .finally(() => {
        stats.lastCycleMs = Date.now() - t0;
        inFlight = null;
      });
  }
  await inFlight;

  return compose(db);
}

/* ---------------- 手动值 ---------------- */
export function readManual(db) {
  try {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('finance.manual');
    return row ? JSON.parse(row.value) : {};
  } catch {
    return {};
  }
}

export function writeManual(db, id, patch) {
  if (!MANUAL_IDS.includes(id)) throw new Error('该指标不支持手动录入');
  const all = readManual(db);
  all[id] = { ...(all[id] || {}), ...patch, at: new Date().toISOString() };
  if (patch.value === '' || patch.value == null) all[id].value = null;
  db.prepare(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run('finance.manual', JSON.stringify(all));
  return all[id];
}

export function invalidate() {
  store.clear();
  cnnValue = null;
}
