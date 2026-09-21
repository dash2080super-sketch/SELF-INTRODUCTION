/**
 * dividend —— 数据抓取 + 策略计算引擎。
 *
 * 数据源（全部公开、无需 key）：
 *   腾讯财经  qt.gtimg.cn                          → 实时价 / PE / PB / 市值
 *   腾讯财经  web.ifzq.gtimg.cn/appstock/app/fqkline → 前复权日/周/月 K 线
 *   东财数据中心 datacenter-web.eastmoney.com       → 分红送转历史
 *   中债估值中心 yield.chinabond.com.cn             → 国债收益率曲线（10Y 锚）
 *
 * 踩坑备忘（别改回去）：
 *   1. 东财 push2 / push2his 对海外 IP 返回 502 / 断连，行情和 K 线一律走腾讯。
 *   2. 东财 rem 字段 PRETAX_BONUS_RMB 是「每 10 股派息（含税）」，不是每股 —— 要 /10。
 *   3. 中债接口是 POST + ?workTime=YYYY-MM-DD 拿某一天的曲线，返回 HTML 表格片段，
 *      不是 JSON；而且要按「表头里 10年 那一列的序号」去数据行取值。
 *   4. 腾讯返回 GBK，必须按 gbk 解码，否则股票名全是乱码。
 */
import {
  STRATEGY,
  NOTES,
  SEED_WATCHLIST,
  normalizeCode,
  txPrefix,
  marketName,
} from './dividend-catalog.js';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

let gbkDecoder = null;
function decodeGBK(buf) {
  if (!gbkDecoder) {
    try {
      gbkDecoder = new TextDecoder('gbk');
    } catch {
      gbkDecoder = null; // ICU 不全时降级，下面的正则仍能取到数字，只是名字会乱
    }
  }
  return gbkDecoder ? gbkDecoder.decode(buf) : Buffer.from(buf).toString('latin1');
}

async function getText(url, { headers = {}, timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, ...headers },
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return decodeGBK(await r.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

async function postText(url, { headers = {}, timeout = 20000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body: '',
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer()).toString('utf8');
  } finally {
    clearTimeout(t);
  }
}

/* ============================================================
   缓存 + 计数
   ============================================================ */
const cache = new Map(); // key -> { at, value }
const inflight = new Map(); // key -> Promise

export const stats = {
  requests: 0,
  errors: 0,
  lastError: '',
  lastCycleMs: 0,
  lastRunAt: 0,
  cycles: 0,
  cacheHits: 0,
};

function cached(key) {
  const e = cache.get(key);
  if (!e) return null;
  const ttl = key.startsWith('kline:') && key.includes(':day')
    ? STRATEGY.ttl.klineDay
    : key.startsWith('kline:week')
      ? STRATEGY.ttl.klineWeek
      : key.startsWith('kline:month')
        ? STRATEGY.ttl.klineMonth
        : key.startsWith('div:')
          ? STRATEGY.ttl.dividend
          : key === 'anchor'
            ? STRATEGY.ttl.anchor
            : STRATEGY.ttl.quote;
  if (Date.now() - e.at > ttl) return null;
  return e;
}

/** 合并并发请求：同一 key 同时被多个调用方要，只打一次上游。
 *  ⚠️ 拿到 null 不写缓存 —— 否则一次网络抖动会把「国债锚」锁死 6 小时。 */
function once(key, fn) {
  const hit = cached(key);
  if (hit) {
    stats.cacheHits++;
    return Promise.resolve(hit.value);
  }
  if (inflight.has(key)) return inflight.get(key);
  const p = fn()
    .then((value) => {
      if (value != null && !(Array.isArray(value) && value.length === 0)) {
        cache.set(key, { at: Date.now(), value });
        if (PERSIST_KEYS(key)) schedulePersist();
      }
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/* ============================================================
   长周期数据的磁盘缓存
   ------------------------------------------------------------
   国债锚（6h）和分红（12h）都是慢变量，但只在内存里缓存的话，
   每次重启服务（部署、重启机器）第一个访问的人要重付 ~10 秒。
   把它们落到 data/dividend-cache.json，重启后直接恢复。
   ============================================================ */
const PERSIST_PATH = path.join(path.dirname(config.dbPath), 'dividend-cache.json');
const PERSIST_KEYS = (k) => k === 'anchor' || k.startsWith('div:');
const persistTtl = (k) => (k === 'anchor' ? STRATEGY.ttl.anchor : STRATEGY.ttl.dividend);

function loadPersisted() {
  try {
    if (!fs.existsSync(PERSIST_PATH)) return;
    const obj = JSON.parse(fs.readFileSync(PERSIST_PATH, 'utf8'));
    let n = 0;
    for (const [k, e] of Object.entries(obj)) {
      if (!e || typeof e.at !== 'number' || !PERSIST_KEYS(k)) continue;
      if (Date.now() - e.at > persistTtl(k)) continue; // 过期的丢掉
      cache.set(k, e);
      n++;
    }
    if (n) console.log(`[dividend] 从磁盘恢复 ${n} 条长周期缓存（国债锚 / 分红）`);
  } catch (e) {
    console.warn('[dividend] 读取磁盘缓存失败:', e.message);
  }
}
loadPersisted();

let persistTimer = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const obj = {};
      for (const [k, e] of cache) if (PERSIST_KEYS(k)) obj[k] = e;
      fs.mkdirSync(path.dirname(PERSIST_PATH), { recursive: true });
      fs.writeFileSync(PERSIST_PATH, JSON.stringify(obj));
    } catch (e) {
      console.warn('[dividend] 写磁盘缓存失败:', e.message);
    }
  }, 2000);
  persistTimer.unref?.();
}

export function invalidate() {
  cache.clear();
}

/* ============================================================
   腾讯实时行情（批量 + 按只缓存）
   ------------------------------------------------------------
   为什么要按「单只」缓存而不是按「整批」缓存：
   getDividend 会先批量拉一次（1 个请求拿全部），紧接着每只标的自己
   又要查一次行情。如果按整批缓存，key 不一致 → 每只都要重打一次，
   3 只股票就白白多 3 个请求。按单只缓存后，批量那次的结果会被逐只
   写进缓存，后面的单只查询全部命中。
   ============================================================ */
export async function fetchQuotes(codes) {
  const list = [...new Set(codes.map(normalizeCode).filter(Boolean))];
  if (!list.length) return {};

  const out = {};
  const need = [];
  for (const c of list) {
    const hit = cached('quote:' + c);
    if (hit) {
      stats.cacheHits++;
      out[c] = hit.value;
    } else {
      need.push(c);
    }
  }
  if (!need.length) return out;

  const url = 'https://qt.gtimg.cn/q=' + need.map(txPrefix).join(',');
  stats.requests++;
  let txt;
  try {
    txt = await getText(url, { headers: { Referer: 'https://gu.qq.com/' } });
  } catch (e) {
    stats.errors++;
    stats.lastError = '腾讯行情: ' + e.message;
    if (Object.keys(out).length) return out; // 有旧值就先给旧值
    throw e;
  }
  for (const line of txt.split(';')) {
    if (!line.includes('="')) continue;
    const key = line.split('=')[0].split('_').pop().trim();
    const raw = line.split('"')[1];
    if (!raw) continue;
    const v = raw.split('~');
    if (v.length < 53) continue;
    const code = key.replace(/^(sh|sz|bj)/, '');
    const num = (i) => (v[i] === '' || v[i] == null ? null : Number(v[i]));
    const q = {
      code,
      name: v[1],
      price: num(3),
      lastClose: num(4),
      open: num(5),
      chgAmt: num(31),
      chgPct: num(32),
      high: num(33),
      low: num(34),
      turnoverPct: num(38),
      peTtm: num(39),
      mcapYi: num(44),
      floatMcapYi: num(45),
      pb: num(46),
      at: Date.now(),
      src: '腾讯财经',
    };
    out[code] = q;
    cache.set('quote:' + code, { at: Date.now(), value: q });
  }
  return out;
}

/* ============================================================
   腾讯 K 线（前复权）
   ============================================================ */
export async function fetchKline(code, period) {
  const c = normalizeCode(code);
  const sym = txPrefix(c);
  const n = period === 'day' ? 260 : period === 'week' ? 140 : 72;
  const key = `kline:${period}:${c}`;
  return once(key, async () => {
    const url =
      `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},${period},,,${n},qfq`;
    stats.requests++;
    try {
      const txt = await getText(url, { headers: { Referer: 'https://gu.qq.com/' } });
      const d = JSON.parse(txt);
      const node = d?.data?.[sym] || {};
      const rows = node[`qfq${period}`] || node[period] || [];
      // [date, open, close, high, low, volume]
      const bars = rows
        .map((r) => ({
          date: r[0],
          open: Number(r[1]),
          close: Number(r[2]),
          high: Number(r[3]),
          low: Number(r[4]),
          vol: Number(r[5]),
        }))
        .filter((b) => Number.isFinite(b.close) && b.close > 0);
      return bars;
    } catch (e) {
      stats.errors++;
      stats.lastError = `腾讯K线(${c}/${period}): ` + e.message;
      throw e;
    }
  });
}

/* ============================================================
   东财分红送转（带串行限流）
   ============================================================ */
let emChain = Promise.resolve();
let emLast = 0;
function emThrottle(fn) {
  const run = emChain.then(async () => {
    const wait = STRATEGY.eastmoneyIntervalMs - (Date.now() - emLast);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      emLast = Date.now();
    }
  });
  emChain = run.catch(() => {});
  return run;
}

export async function fetchDividends(code) {
  const c = normalizeCode(code);
  const key = `div:${c}`;
  return once(key, () =>
    emThrottle(async () => {
      const filter = encodeURIComponent(`(SECURITY_CODE="${c}")`);
      const url =
        'https://datacenter-web.eastmoney.com/api/data/v1/get' +
        '?reportName=RPT_SHAREBONUS_DET&columns=ALL' +
        `&filter=${filter}&pageNumber=1&pageSize=80` +
        '&sortColumns=EX_DIVIDEND_DATE&sortTypes=-1&source=WEB&client=WEB';
      stats.requests++;
      try {
        const txt = await getText(url, { headers: { Referer: 'https://data.eastmoney.com/' } });
        const d = JSON.parse(txt);
        const rows = (d?.result?.data || []).map((r) => {
          const plan = String(r.IMPL_PLAN_PROFILE || r.ASSIGN_PROGRESS || '');
          const per10 = Number(r.PRETAX_BONUS_RMB) || 0; // ⚠️ 每 10 股，不是每股
          // ⚠️ REPORT_DATE 形如 "2025-12-31 00:00:00"，判断年末必须用 slice 出来的 mm-dd，
          //    用 endsWith('12-31') 会永远为 false，导致"完整财年"判定失效。
          const reportDate = String(r.REPORT_DATE || '').slice(0, 10);
          return {
            exDate: String(r.EX_DIVIDEND_DATE || '').slice(0, 10),
            fiscalYear: reportDate.slice(0, 4),
            period: reportDate.slice(5, 10),
            perShare: +(per10 / 10).toFixed(4),
            isAnnual: reportDate.slice(5, 10) === '12-31',
            plan: plan.slice(0, 80),
            special: /特别/.test(plan),
          };
        });
        return rows;
      } catch (e) {
        stats.errors++;
        stats.lastError = `东财分红(${c}): ` + e.message;
        throw e;
      }
    })
  );
}

/* ============================================================
   中债国债收益率曲线 → 10Y 锚
   ============================================================ */
function isWeekend(ymd) {
  const d = new Date(ymd + 'T00:00:00Z');
  const w = d.getUTCDay();
  return w === 0 || w === 6;
}

function shiftDay(ymd, delta) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** 解析中债返回的 HTML 表格片段，取出 10 年期国债收益率 */
function parseChinabond(html) {
  const trs = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  if (!trs.length) return null;
  const cellText = (tr) =>
    [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())
      .filter((s) => s !== '');

  const headerIdx = trs.findIndex((tr) => cellText(tr).some((c) => /10\s*年/.test(c)));
  if (headerIdx < 0) return null;
  const header = cellText(trs[headerIdx]);
  let col = header.findIndex((c) => /10\s*年/.test(c));
  // 数据行（含「中债国债收益率曲线」那行）
  let row = null;
  for (let i = headerIdx + 1; i < trs.length; i++) {
    const cells = cellText(trs[i]);
    if (cells.length && /国债收益率曲线/.test(cells[0])) {
      row = cells;
      break;
    }
  }
  if (!row) return null;
  // 列数对不齐时，10 年在尾部倒数第二列，用它兜底
  if (row.length !== header.length) col = row.length >= 2 ? row.length - 2 : col;
  const v = Number(row[col]);
  const date = (html.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
  if (!Number.isFinite(v) || v <= 0 || v > 30) return null;
  return { y10: v, date };
}

function chinabondUrl(ymd) {
  return 'https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/queryGjqxInfo' + `?&workTime=${ymd}&locale=zh_CN`;
}

/** 拉某一天的曲线，失败返回 null */
async function fetchChinabondDay(ymd) {
  stats.requests++;
  try {
    const html = await postText(chinabondUrl(ymd), {
      headers: { Referer: 'https://yield.chinabond.com.cn/cbweb-cbrc-web/' },
    });
    const parsed = parseChinabond(html);
    if (!parsed) return null;
    return { y10: parsed.y10, date: parsed.date || ymd, curveDate: ymd, src: '中债估值中心', at: Date.now() };
  } catch (e) {
    stats.errors++;
    stats.lastError = '中债: ' + e.message;
    return null;
  }
}

export async function fetchAnchor() {
  return once('anchor', async () => {
    // 中债是日终数据：当天可能还没发布（比如早上），所以要往前找最近的工作日。
    // 串行往前试每天要 ~2.5 秒，试两次就 5 秒 —— 改成前 3 个候选工作日并发打，
    // 谁先给出最新的日期就用谁，冷启动从 ~5 秒降到 ~2.5 秒。
    const cands = [];
    let d = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < 20 && cands.length < 3; i++) {
      if (!isWeekend(d)) cands.push(d);
      d = shiftDay(d, -1);
    }
    const results = (await Promise.all(cands.map(fetchChinabondDay))).filter(Boolean);
    if (!results.length) return null;
    // 取日期最新的那条（用请求的曲线日期比较，比返回文本里的日期可靠）
    results.sort((a, b) => b.curveDate.localeCompare(a.curveDate));
    return results[0];
  });
}

/* ============================================================
   计算：布林带
   ============================================================ */
export function boll(bars, period = 20, mult = 2) {
  if (!bars || bars.length < period + 1) return null;
  const closes = bars.map((b) => b.close);
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, c) => a + c, 0) / period;
  const varc = slice.reduce((a, c) => a + (c - mid) ** 2, 0) / period;
  const sd = Math.sqrt(varc);
  const upper = mid + mult * sd;
  const lower = mid - mult * sd;
  const last = closes[closes.length - 1];
  return {
    mid: +mid.toFixed(3),
    upper: +upper.toFixed(3),
    lower: +lower.toFixed(3),
    sd: +sd.toFixed(4),
    widthPct: mid > 0 ? +(((upper - lower) / mid) * 100).toFixed(2) : null,
    last: +last.toFixed(3),
    asOf: bars[bars.length - 1].date,
  };
}

/** 价格距某条轨的百分比（正数=在轨上方） */
function pctAbove(price, line) {
  if (!line || !Number.isFinite(line) || line <= 0) return null;
  return +(((price - line) / line) * 100).toFixed(2);
}

/** 位置分档：in / near / out */
function bandState(pct, inPct, nearPct) {
  if (pct == null) return { state: 'na', pct: null };
  if (pct <= inPct) return { state: 'in', pct };
  if (pct <= nearPct) return { state: 'near', pct };
  return { state: 'out', pct };
}

/* ============================================================
   计算：分红 → 最新完整财年每股分红
   ============================================================ */
export function latestFiscalDividend(rows) {
  if (!rows || !rows.length) return null;
  const byYear = new Map();
  for (const r of rows) {
    if (!r.fiscalYear || !r.perShare) continue;
    if (!byYear.has(r.fiscalYear)) {
      byYear.set(r.fiscalYear, { year: r.fiscalYear, total: 0, parts: [], hasAnnual: false });
    }
    const y = byYear.get(r.fiscalYear);
    y.total += r.perShare;
    y.parts.push(r);
    if (r.isAnnual) y.hasAnnual = true;
  }
  const years = [...byYear.values()].sort((a, b) => b.year.localeCompare(a.year));
  // 完整财年 = 有年末（12-31）方案的那一年
  const complete = years.filter((y) => y.hasAnnual);
  const pick = complete[0] || years[0];
  if (!pick) return null;
  return {
    year: pick.year,
    perShare: +pick.total.toFixed(4),
    complete: pick.hasAnnual,
    /** 有多少个完整财年有分红（质量检测用，不截断） */
    yearCount: complete.length,
    parts: pick.parts
      .slice()
      .sort((a, b) => b.period.localeCompare(a.period))
      .map((p) => ({
        exDate: p.exDate,
        period: p.period,
        perShare: p.perShare,
        special: p.special,
        plan: p.plan,
      })),
    /** 全部完整财年（倒序），前面的字段给质量检测，history 只取最近 8 年给前端展示 */
    allYears: complete.map((y) => ({ year: y.year, perShare: +y.total.toFixed(4) })),
    history: complete.map((y) => ({ year: y.year, perShare: +y.total.toFixed(4) })).slice(0, 8),
  };
}

/* ============================================================
   质量检测
   ============================================================ */
function qualityCheck(q, div) {
  const Q = STRATEGY.quality;
  const checks = [];

  const years = div?.yearCount ?? 0;
  const enoughYears = years >= Q.minDividendYears;
  checks.push({
    key: 'years',
    name: '连续分红年数',
    ok: enoughYears,
    detail: !years
      ? '无完整财年分红记录'
      : enoughYears
        ? `${years} 个完整财年有分红记录（门槛 ${Q.minDividendYears}）`
        : `只有 ${years} 个完整财年（门槛 ${Q.minDividendYears}）——` +
          `常见原因是 A 股上市时间短（港美股分红历史不计入）。公司本身可能分红很久了，` +
          `但本页只看 A 股可查记录，所以按严格口径先拦下，需你人工判断`,
  });

  checks.push({
    key: 'scale',
    name: '市值规模',
    ok: (q?.mcapYi ?? 0) >= Q.minMcapYi,
    detail: q?.mcapYi ? `总市值 ${q.mcapYi.toFixed(0)} 亿（门槛 ${Q.minMcapYi} 亿）` : '市值未知',
  });

  const peOk = q?.peTtm != null && q.peTtm > 0;
  checks.push({
    key: 'pe',
    name: '盈利为正',
    ok: Q.requirePositivePE ? peOk : true,
    detail: q?.peTtm != null ? `PE(TTM) ${q.peTtm.toFixed(2)}` : 'PE 未知',
  });

  // 分红是否断崖式下滑：最新完整财年 vs 4 年及以上之前的那一年（取最近的那个）
  const ys = div?.allYears || [];
  let decay = null;
  let baseYear = null;
  if (ys.length >= 2) {
    const latest = ys[0];
    const base = ys.find((h) => Number(latest.year) - Number(h.year) >= 4) || ys[ys.length - 1];
    if (base && base.perShare > 0 && base.year !== latest.year) {
      decay = +(latest.perShare / base.perShare).toFixed(2);
      baseYear = base.year;
    }
  }
  checks.push({
    key: 'decay',
    name: '分红未断崖下滑',
    ok: decay == null ? true : decay >= Q.dividendDecayFloor,
    detail:
      decay == null
        ? `分红历史不足（只有 ${ys.length} 个完整财年），跳过`
        : `${ys[0].year} 年 / ${baseYear} 年 ≈ ${decay}（门槛 ≥ ${Q.dividendDecayFloor}）`,
  });

  return { ok: checks.every((c) => c.ok), checks };
}

/* ============================================================
   单只标的的完整评估
   ============================================================ */
export async function evaluate(code, meta = {}) {
  const c = normalizeCode(code);
  const S = STRATEGY;

  const [quoteMap, anchor, dayBars, weekBars, monthBars] = await Promise.all([
    fetchQuotes([c]),
    fetchAnchor(),
    fetchKline(c, 'day'),
    fetchKline(c, 'week'),
    fetchKline(c, 'month'),
  ]);
  const q = quoteMap[c] || null;

  let div = null;
  let divErr = '';
  try {
    div = latestFiscalDividend(await fetchDividends(c));
  } catch (e) {
    divErr = e.message;
  }

  const missing = [];
  if (!q) missing.push('实时行情');
  if (!anchor) missing.push('国债收益率锚');
  if (!div) missing.push('分红数据');
  if (!dayBars?.length) missing.push('日线');

  const price = q?.price ?? null;
  const dps = div?.perShare ?? null;
  const y10 = anchor?.y10 ?? null;

  const yieldNow = price && dps ? +((dps / price) * 100).toFixed(2) : null;
  const anchor3x = y10 != null ? +(y10 * S.anchorMultiple).toFixed(3) : null;

  // 股息率网格：目标价 = 每股分红 ÷ 目标股息率
  let grid = [];
  let target3 = null;
  if (dps && y10) {
    grid = S.gridLevels.map((lv) => {
      const yld = +(y10 * lv).toFixed(3);
      const tp = +(dps / (yld / 100)).toFixed(3);
      return {
        level: lv,
        yieldPct: yld,
        price: tp,
        hit: price != null ? price <= tp : null,
        gapPct: price != null ? +(((price - tp) / tp) * 100).toFixed(2) : null,
      };
    });
    target3 = grid[0]?.price ?? null;
  }

  const bollDay = boll(dayBars, S.technical.bollPeriod, S.technical.bollStd);
  const bollWeek = boll(weekBars, S.technical.bollPeriod, S.technical.bollStd);
  const bollMonth = boll(monthBars, S.technical.bollPeriod, S.technical.bollStd);
  if (!bollWeek) missing.push('周线');
  if (!bollMonth) missing.push('月线');

  const tech = price
    ? {
        day: bandState(pctAbove(price, bollDay?.lower), S.technical.inPct, S.technical.nearPct),
        week: bandState(pctAbove(price, bollWeek?.lower), S.technical.weekMonthInPct, S.technical.weekMonthNearPct),
        month: bandState(pctAbove(price, bollMonth?.lower), S.technical.weekMonthInPct, S.technical.weekMonthNearPct),
      }
    : { day: { state: 'na' }, week: { state: 'na' }, month: { state: 'na' } };

  const valOk = yieldNow != null && anchor3x != null ? yieldNow >= anchor3x : null;
  const quality = qualityCheck(q, div);

  // 信号判定
  let signal = { key: 'nodata', label: '数据不足', hint: '必要数据缺失，不生成信号' };
  if (!missing.length && valOk != null) {
    const d = tech.day.state;
    const wk = tech.week.state;
    const mo = tech.month.state;
    const gap = price && target3 ? ((price - target3) / target3) * 100 : null;
    const valClose = gap != null && gap <= S.valuationNearPct; // 距 3× 锚买点够近
    if (!quality.ok) {
      signal = { key: 'excluded', label: '未过质量检测', hint: '基本面或分红记录不达标，不参与择时' };
    } else if (valOk && d === 'in' && (wk === 'in' || mo === 'in')) {
      signal = { key: 'resonance', label: '买入共振', hint: '估值达标 + 日周月技术位置到位，可按下面对应档位分批建仓' };
    } else if (valOk && d === 'in') {
      signal = { key: 'near', label: '临近 · 等大周期', hint: '估值达标、日线已到位，等周线或月线也回到下轨区' };
    } else if (valOk && (d === 'near' || wk === 'near' || mo === 'near')) {
      signal = { key: 'near', label: '临近 · 等技术位置', hint: '估值已达标，等价格回到布林带下轨附近再动手' };
    } else if (valOk) {
      signal = { key: 'valuation-ok', label: '等待 · 估值已达标', hint: '估值条件成立，但技术位置还没进买点区，可以开始盯' };
    } else if ((d === 'in' || d === 'near') && valClose) {
      signal = { key: 'near', label: '临近 · 等估值达标', hint: `技术位置已到，股息率离 3× 锚还差 ${gap?.toFixed(2)}%` };
    } else if (d === 'in' || d === 'near') {
      signal = {
        key: 'wait',
        label: '等待 · 估值偏离较远',
        hint: `技术位置在下轨附近，但股息率离 3× 锚还差 ${gap?.toFixed(2)}%（超过 ${S.valuationNearPct}% 闸门），不算临近`,
      };
    } else {
      signal = { key: 'wait', label: '等待', hint: '估值和技术位置都还没到' };
    }
  }

  return {
    code: c,
    name: q?.name || meta.name || c,
    tag: meta.tag || '',
    note: meta.note || '',
    market: marketName(c),
    price,
    chgPct: q?.chgPct ?? null,
    pe: q?.peTtm ?? null,
    pb: q?.pb ?? null,
    mcapYi: q?.mcapYi ?? null,
    quoteAt: q?.at ?? null,
    dps,
    fiscal: div
      ? {
          year: div.year,
          perShare: div.perShare,
          complete: div.complete,
          yearCount: div.yearCount,
          parts: div.parts,
          history: div.history,
        }
      : null,
    yieldNow,
    anchor: anchor ? { y10: anchor.y10, date: anchor.date, src: anchor.src } : null,
    anchor3x,
    target3,
    gapToTargetPct: price && target3 ? +(((price - target3) / target3) * 100).toFixed(2) : null,
    grid,
    boll: { day: bollDay, week: bollWeek, month: bollMonth },
    tech,
    valOk,
    quality,
    signal,
    missing,
    divErr,
  };
}

/* ============================================================
   关注列表（SQLite）
   ============================================================ */
export const WATCHLIST_DDL = `
CREATE TABLE IF NOT EXISTS dividend_watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  tag TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function readWatchlist(db) {
  const rows = db.prepare('SELECT * FROM dividend_watchlist ORDER BY sort ASC, id ASC').all();
  if (rows.length) return rows;
  // 首次访问：写入初始关注池，之后一切以数据库为准
  const ins = db.prepare('INSERT OR IGNORE INTO dividend_watchlist (code, name, tag, note, sort) VALUES (?,?,?,?,?)');
  const tx = db.transaction(() => {
    SEED_WATCHLIST.forEach((s, i) => ins.run(s.code, s.name, s.tag, s.note, i));
  });
  tx();
  return db.prepare('SELECT * FROM dividend_watchlist ORDER BY sort ASC, id ASC').all();
}

export function addWatch(db, { code, name, tag, note }) {
  const c = normalizeCode(code);
  if (!c) throw new Error('股票代码要是 6 位数字，比如 600036');
  const max = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM dividend_watchlist').get().m;
  const exists = db.prepare('SELECT id FROM dividend_watchlist WHERE code = ?').get(c);
  if (exists) throw new Error(`${c} 已经在关注列表里了`);
  db.prepare('INSERT INTO dividend_watchlist (code, name, tag, note, sort) VALUES (?,?,?,?,?)').run(
    c,
    String(name || '').slice(0, 40),
    String(tag || '').slice(0, 20),
    String(note || '').slice(0, 200),
    max + 1
  );
  return c;
}

export function updateWatch(db, id, { name, tag, note }) {
  const row = db.prepare('SELECT * FROM dividend_watchlist WHERE id = ?').get(id);
  if (!row) throw new Error('没有这条记录');
  db.prepare('UPDATE dividend_watchlist SET name=?, tag=?, note=? WHERE id=?').run(
    String(name ?? row.name).slice(0, 40),
    String(tag ?? row.tag).slice(0, 20),
    String(note ?? row.note).slice(0, 200),
    id
  );
}

export function removeWatch(db, id) {
  const r = db.prepare('DELETE FROM dividend_watchlist WHERE id = ?').run(id);
  if (!r.changes) throw new Error('没有这条记录');
}

/* ============================================================
   总入口
   ============================================================ */
export async function getDividend(db, { force = false } = {}) {
  const t0 = Date.now();
  if (force) invalidate();
  stats.cycles++;

  const watch = readWatchlist(db);
  const codes = watch.map((w) => w.code);

  // 先批量拉一次行情（一次请求拿全部，并逐只写入缓存），再并发算每只
  try {
    await fetchQuotes(codes);
  } catch {}

  // 并发处理：腾讯接口不封 IP，可以放开了打；
  // 东财那条线有自己的串行队列（emThrottle），所以并发也不会把它打爆。
  // 串行改并发前冷启动 11.8 秒，改完 ~5 秒。
  const items = await Promise.all(
    watch.map(async (w) => {
      try {
        const it = await evaluate(w.code, { name: w.name, tag: w.tag, note: w.note });
        it.id = w.id;
        it.userNote = w.note;
        it.userTag = w.tag || it.tag;
        if (!it.name || it.name === w.code) it.name = w.name || it.name;
        return it;
      } catch (e) {
        return {
          code: w.code,
          id: w.id,
          name: w.name || w.code,
          userTag: w.tag,
          userNote: w.note,
          error: e.message,
          missing: ['全部'],
          signal: { key: 'error', label: '取数失败', hint: e.message },
        };
      }
    })
  );

  const anchorAny = items.find((i) => i.anchor)?.anchor || null;
  const counts = items.reduce(
    (a, i) => {
      const k = i.signal?.key || 'nodata';
      a[k] = (a[k] || 0) + 1;
      return a;
    },
    {}
  );

  stats.lastCycleMs = Date.now() - t0;
  stats.lastRunAt = Date.now();

  return {
    strategy: {
      anchorMultiple: STRATEGY.anchorMultiple,
      gridLevels: STRATEGY.gridLevels,
      technical: STRATEGY.technical,
      quality: STRATEGY.quality,
      valuationNearPct: STRATEGY.valuationNearPct,
    },
    anchor: anchorAny,
    notes: NOTES,
    items,
    counts,
    meta: {
      mode: 'on-demand',
      cycles: stats.cycles,
      requests: stats.requests,
      errors: stats.errors,
      lastError: stats.lastError,
      cacheHits: stats.cacheHits,
      lastCycleMs: stats.lastCycleMs,
      watched: watch.length,
    },
  };
}
