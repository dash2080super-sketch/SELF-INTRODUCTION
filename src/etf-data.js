/**
 * etf-data —— ETF / 场内标的行情数据源（纯抓取 + 缓存，不含路由）。
 *
 * 【2026-09-25 数据源换血】东财在这台新加坡 VPS 上大面积不可用，实测：
 *   · push2 / push2delay 的 stock/get、ulist.np      → HTTP 502（边缘拒境外 IP）
 *   · push2his（63 / http 明文 / https / v6 全试过） → TCP 可握手，响应前被掐断
 *   · clist 白天还通，当晚复测也全系列 502（含 ETF 排行榜 b:MK0021）→ 整条东财行情线废掉
 *   · 还活着的只有：fflow(资金流)、api.fund(净值)、fundf10(概况)
 * 于是（2026-09-25 晚定稿）：
 *   · 行情  —— 腾讯 qt.gtimg.cn（主）→ 东财 clist → 东财 stock/get
 *   · K线   —— 腾讯 newfqkline(日/周/月, 含成交额+换手率) / mkline(分钟) → 东财 push2his
 *   · 资金流—— 东财 push2delay 的 fflow 仍然活着，单独开一个 kind，别和 K线 共用主机表
 *   · 净值/概况 —— 东财，原样不动
 *   · ETF 列表（搜索）—— 新浪 Market_Center(etf_hq_fund, 100 条/页 × 17 页) → 东财 clist
 * 另外加了通道级熔断 deadUntil：某条东财通道确认全挂后 10 分钟内直接跳过，
 * 不让每次首屏都为注定失败的域名白等 2~3 秒。熔断按 kind 分开，flow 活着就不该被 quote 连坐。
 * 其他两个坑，写在这里免得以后再踩：
 *  1. 海外 IP 访问 push2.eastmoney.com 会被 302 到 push2delay（延时行情节点），
 *     Node 的 fetch 跟跳转时不时直接 fetch failed —— 所以首选 push2delay，push2 兜底。
 *  2. 东财的 f71 不是 IOPV，是当日均价（实测 f71 ≈ 成交额/成交量，恒等于均价）。
 *     单股接口里根本没有 IOPV 字段，所以溢价率一律用「最新官方单位净值」口径算，
 *     并在页面上标出净值日期（QDII 净值滞后 1~2 天，溢价会被系统性放大，必须注明）。
 *
 * 腾讯接口的两个口径坑：
 *   · qt.gtimg.cn 返回 GBK，Node 用 new TextDecoder('gbk') 解（本机 ICU 支持）。
 *   · newfqkline 每行 11 列：[日期,开,收,高,低,量(手),{},换手率,额(万元),0,0]
 *     mkline     每行 8 列：[时间,开,收,高,低,量(手),{},换手率×100] —— **没有成交额**，
 *     所以分钟周期的 amt 是 null，不是算错。
 */

import fs from 'node:fs';
import path from 'node:path';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/* 资金流磁盘归档目录。
   为什么需要：push2delay 的 fflow 处于「薛定谔」状态——实测同一个 URL，
   有时一次给满 120 天（513880 拿到过 2026-04-03 → 09-24 完整序列），
   有时只给最新 1 天（512480、以及之后对 513880 的每次重试都只有 1 天）。
   所以历史不能靠单次抓取，要按日期合并攒出来：给多少就并多少。 */
const FLOW_DIR = '/opt/billboard/data';
const flowFile = (code) => path.join(FLOW_DIR, `flow_${String(code)}.json`);

function flowRead(code) {
  try {
    const v = JSON.parse(fs.readFileSync(flowFile(code), 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function flowWrite(code, rows) {
  try {
    fs.mkdirSync(FLOW_DIR, { recursive: true });
    const f = flowFile(code);
    fs.writeFileSync(f + '.tmp', JSON.stringify(rows));
    fs.renameSync(f + '.tmp', f); // 原子替换，读到一半的文件不至于把接口打挂
  } catch {
    /* 写盘失败就算了，不能让归档问题把行情请求拖垮 */
  }
}

/** 按日期合并新旧两段资金流（新的覆盖旧的） */
function mergeByDate(oldRows, freshRows, keep = 400) {
  const m = new Map();
  for (const r of oldRows) if (r && r.t) m.set(r.t, r);
  for (const r of freshRows) if (r && r.t) m.set(r.t, r);
  return [...m.values()].sort((a, b) => (a.t < b.t ? -1 : 1)).slice(-keep);
}

/** 候选域名：按顺序试，成功那个记下来下次优先用 */
const HOSTS = {
  quote: ['https://push2delay.eastmoney.com', 'https://push2.eastmoney.com'],
  his: [
    'https://63.push2his.eastmoney.com',
    'http://push2his.eastmoney.com',
    'https://push2his.eastmoney.com',
  ],
  // 资金流走 clist/fflow 所在的 push2delay —— 它和 K线 的可用性不一样，
  // 必须单独一张表，否则「记住的可用域名」会互相污染。
  flow: [
    'https://push2delay.eastmoney.com',
    'https://push2.eastmoney.com',
    'https://63.push2his.eastmoney.com',
    'http://push2his.eastmoney.com',
    'https://push2his.eastmoney.com',
  ],
};
const goodHost = { quote: null, his: null, flow: null };

/* 熔断：某个通道整体打不通时，别每次请求都白等一遍（实测每个坏域名要 1.6~3s）。
   2026-09-25 晚：push2/push2delay 的 clist、stock/get 全部 502（连之前活着的 clist
   也封了），但 push2delay 的 fflow 还活着 —— 所以熔断必须按通道分开记，
   不能因为 quote 死了就把 flow 一起掐掉。 */
const deadUntil = { quote: 0, his: 0, flow: 0 };
const DEAD_TTL = 10 * 60 * 1000; // 10 分钟后重试一次，万一东财哪天放开
const isDead = (kind) => Date.now() < deadUntil[kind];

/** 6 位代码 -> 腾讯前缀（5/6/9 开头沪市） */
const txCode = (code) => (/^[569]/.test(String(code)) ? 'sh' : 'sz') + String(code);

/* ---------------- 基础 HTTP ---------------- */

async function httpGet(url, { timeout = 12000, referer, jsonp = false, binary = false } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (binary) return Buffer.from(await res.arrayBuffer());
    let t = await res.text();
    if (jsonp) {
      t = t.trim();
      const m = t.match(/^(?:cb|jQuery\w*)?\(?(.*?)\)?$/s);
      if (m) t = m[1];
    }
    return t;
  } finally {
    clearTimeout(timer);
  }
}

async function emGet(kind, path, referer) {
  if (isDead(kind)) throw new Error(`东财 ${kind} 通道熔断中（10 分钟内已确认不可用）`);
  const order = goodHost[kind] ? [goodHost[kind], ...HOSTS[kind].filter((h) => h !== goodHost[kind])] : HOSTS[kind];
  let lastErr;
  for (const base of order) {
    try {
      const t = await httpGet(base + path, { referer });
      if (!t || t.length < 10) throw new Error('empty response');
      goodHost[kind] = base;
      deadUntil[kind] = 0;
      return t;
    } catch (e) {
      lastErr = e;
    }
  }
  deadUntil[kind] = Date.now() + DEAD_TTL;
  throw lastErr || new Error('东财全部域名不可达');
}

async function emJson(kind, path, referer) {
  const t = await emGet(kind, path, referer);
  return JSON.parse(t);
}

/* ---------------- 极简缓存 ---------------- */

const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  try {
    const v = await fn();
    cache.set(key, { t: Date.now(), v });
    if (cache.size > 300) {
      // 512MB 的小鸡，别让缓存无限长：直接丢掉最早写入的一批
      const keys = [...cache.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, 100).map((e) => e[0]);
      keys.forEach((k) => cache.delete(k));
    }
    return v;
  } catch (e) {
    if (hit) return hit.v; // 抓失败就先喂旧的，总比整页空白强
    throw e;
  }
}

/* ---------------- 工具 ---------------- */

/** 6 位代码 -> 东财 secid。5/6/9 开头是沪市（1），其余深市（0） */
export function toSecid(code) {
  const c = String(code || '').trim();
  if (!/^\d{6}$/.test(c)) return null;
  return (/^[569]/.test(c) ? '1.' : '0.') + c;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ---------------- 1) 实时行情 ---------------- */

const QUOTE_FIELDS = [
  'f43', // 最新价
  'f44', // 最高
  'f45', // 最低
  'f46', // 今开
  'f47', // 成交量（手）
  'f48', // 成交额（元）
  'f50', // 量比
  'f57', // 代码
  'f58', // 名称
  'f59', // 小数位
  'f60', // 昨收
  'f86', // 时间戳
  'f107',
  'f116', // 流通市值（ETF 即实时规模）
  'f168', // 换手率
  'f169', // 涨跌额
  'f170', // 涨跌幅
  'f171', // 振幅
  'f189', // 上市日期
].join(',');

/* 东财 clist 单标的过滤（fs=i:secid）：能绕过 stock/get 的封锁，字段几乎一样全
   （f20/f21 市值、f8 换手、f10 量比、f124 时间戳），拿不到的只有 f189 上市日期
   （恒为 "-"），那个字段本来也不关键。
   2026-09-25 晚复测：clist 全系列（含 ETF 排行榜）也 502 了，这个函数现在是兜底。 */
const CLIST_FIELDS =
  'f1,f2,f3,f4,f5,f6,f8,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f59,f124,f189';

async function emQuoteViaClist(code, secid) {
  const j = await emJson(
    'quote',
    `/api/qt/clist/get?pn=1&pz=1&po=1&np=1&fltt=2&invt=2&fid=f3&fs=i:${secid}` +
      `&fields=${CLIST_FIELDS}`
  );
  const it = j && j.data && Array.isArray(j.data.diff) ? j.data.diff[0] : null;
  if (!it || it.f2 == null) throw new Error('clist 没返回这个标的');
  const price = num(it.f2);
  const prevClose = num(it.f18);
  const high = num(it.f15);
  const low = num(it.f16);
  const dec = num(it.f59) ?? 3;
  return {
    code: String(it.f12 || code),
    name: it.f14 || '',
    market: it.f13 != null ? String(it.f13) : secid.split('.')[0],
    decimals: dec,
    price,
    prevClose,
    open: num(it.f17),
    high,
    low,
    change: num(it.f4),
    changePct: num(it.f3),
    amplitude:
      high != null && low != null && prevClose ? ((high - low) / prevClose) * 100 : null,
    volume: num(it.f5), // 手
    amount: num(it.f6), // 元
    turnoverRate: num(it.f8),
    volRatio: num(it.f10),
    scale: num(it.f21) ?? num(it.f20), // 流通市值 ≈ 实时规模（元）
    listingDate: null, // clist 的 f189 恒为 "-"，拿不到就不编
    ts: num(it.f124),
    src: '东财clist',
  };
}

/** 腾讯行情（GBK）。现在的主源：0.17s，字段比东财 clist 还全（量比/换手/规模都有）。 */
async function txQuote(code) {
  const buf = await httpGet(`https://qt.gtimg.cn/q=${txCode(code)}`, {
    timeout: 10000,
    binary: true,
  });
  const raw = new TextDecoder('gbk').decode(buf);
  const i = raw.indexOf('="');
  if (i < 0) throw new Error('腾讯返回异常');
  const a = raw.slice(i + 2).replace(/";?\s*$/, '').split('~');
  if (a.length < 40) throw new Error('腾讯行情字段不足');
  const price = num(a[3]);
  const prevClose = num(a[4]);
  if (price == null || prevClose == null || price <= 0) throw new Error('腾讯没查到这个代码');
  // a[30] = 20260924161438（北京时间）
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(a[30] || ''));
  return {
    code: String(a[2] || code),
    name: a[1] || '',
    market: txCode(code).startsWith('sh') ? '1' : '0',
    decimals: 3,
    price,
    prevClose,
    open: num(a[5]),
    high: num(a[33]),
    low: num(a[34]),
    change: num(a[31]),
    changePct: num(a[32]),
    amplitude: num(a[43]),
    volume: num(a[36]), // 手
    amount: num(a[37]) != null ? num(a[37]) * 1e4 : null, // 万元 -> 元
    turnoverRate: num(a[38]),
    volRatio: num(a[49]),
    scale: num(a[44]) != null ? num(a[44]) * 1e8 : null, // 亿元 -> 元
    listingDate: null,
    ts: m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5], +m[6]) / 1000 : null,
    src: '腾讯',
  };
}

/** 最后兜底：东财单股接口。现在必 502，留着等它哪天放开。 */
async function emQuoteViaStockGet(code, secid) {
  const j = await emJson(
    'quote',
    `/api/qt/stock/get?secid=${secid}&fltt=2&invt=2&fields=${QUOTE_FIELDS}`
  );
  const d = j && j.data;
  if (!d || d.f43 == null) throw new Error('没查到这个代码，确认是场内标的吗');
  const dec = num(d.f59) ?? 3;
  return {
    code: String(d.f57 || code),
    name: d.f58 || '',
    market: secid.split('.')[0],
    decimals: dec,
    price: num(d.f43),
    prevClose: num(d.f60),
    open: num(d.f46),
    high: num(d.f44),
    low: num(d.f45),
    change: num(d.f169),
    changePct: num(d.f170),
    amplitude: num(d.f171),
    volume: num(d.f47),
    amount: num(d.f48),
    turnoverRate: num(d.f168),
    volRatio: num(d.f50),
    scale: num(d.f116),
    listingDate: d.f189 ? String(d.f189) : null,
    ts: num(d.f86),
    src: '东财',
  };
}

export function getQuote(code) {
  return cached('quote:' + code, 10_000, async () => {
    const secid = toSecid(code);
    if (!secid) throw new Error('代码格式不对，需要 6 位数字');
    let lastErr;
    // 腾讯优先：0.17s 且字段齐全（含量比/换手/规模）；东财 clist 自 2026-09-25 晚起
    // 也稳定 502，放前面只会让每次首屏白等 2~3 秒。
    for (const fn of [
      () => txQuote(code),
      () => emQuoteViaClist(code, secid),
      () => emQuoteViaStockGet(code, secid),
    ]) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('行情全部数据源不可达');
  });
}

/* ---------------- 2) K 线 ---------------- */

/** klt: 101日 102周 103月 60/30/15/5 分钟 */
const TX_PERIOD = { 101: 'day', 102: 'week', 103: 'month' };
const TX_MIN = { 5: 'm5', 15: 'm15', 30: 'm30', 60: 'm60' };

/** 补算涨跌幅：腾讯的 K线接口不给 chgPct，用相邻收盘价推（首根为 null）。 */
function fillChgPct(rows) {
  for (let i = 0; i < rows.length; i++) {
    const prev = i > 0 ? rows[i - 1].c : null;
    rows[i].chgPct = prev ? ((rows[i].c - prev) / prev) * 100 : null;
  }
  return rows;
}

async function txKline(code, klt, lmt) {
  const c = txCode(code);
  const rows = [];
  const min = TX_MIN[klt];
  if (min) {
    // mkline: [时间YYYYMMDDHHMM, 开, 收, 高, 低, 量(手), {}, 换手率×100] —— 没有成交额
    const j = JSON.parse(
      await httpGet(`https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${c},${min},,${lmt}`, {
        timeout: 12000,
      })
    );
    const arr = (((j && j.data) || {})[c] || {})[min] || [];
    if (!arr.length) throw new Error('腾讯分钟K线为空');
    for (const r of arr) {
      const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(r[0]));
      rows.push({
        t: m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : String(r[0]),
        o: +r[1],
        c: +r[2],
        h: +r[3],
        l: +r[4],
        v: +r[5],
        amt: null, // 分钟线确实拿不到成交额，不拿均价去编
        turn: Number(r[7]) / 100,
      });
    }
  } else {
    // newfqkline: [日期, 开, 收, 高, 低, 量(手), {}, 换手率, 额(万元), 0, 0]
    const per = TX_PERIOD[klt] || 'day';
    const j = JSON.parse(
      await httpGet(
        `https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param=${c},${per},,,${lmt},`,
        { timeout: 12000 }
      )
    );
    const d = ((j && j.data) || {})[c] || {};
    const arr = d[per] || d.day || [];
    if (!arr.length) throw new Error('腾讯K线为空');
    for (const r of arr) {
      rows.push({
        t: r[0],
        o: +r[1],
        c: +r[2],
        h: +r[3],
        l: +r[4],
        v: +r[5],
        amt: Number(r[8]) * 1e4, // 万元 -> 元
        turn: Number(r[7]),
      });
    }
  }
  return { name: '', code, decimals: 3, klt, rows: fillChgPct(rows), src: '腾讯' };
}

async function emKline(code, klt, lmt, fqt) {
  const secid = toSecid(code);
  const j = await emJson(
    'his',
    `/api/qt/stock/kline/get?secid=${secid}&klt=${klt}&fqt=${fqt}&lmt=${lmt}&end=20500101` +
      '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
  );
  const d = j && j.data;
  if (!d || !Array.isArray(d.klines)) throw new Error('K线为空');
  const rows = d.klines.map((line) => {
    // 日线: 日期,开,收,高,低,量(手),额,振幅%,涨跌%,涨跌额,换手%
    const p = line.split(',');
    return {
      t: p[0],
      o: +p[1],
      c: +p[2],
      h: +p[3],
      l: +p[4],
      v: +p[5],
      amt: +p[6],
      amp: +p[7],
      chgPct: +p[8],
      chg: +p[9],
      turn: +p[10],
    };
  });
  return { name: d.name || '', code: d.code || code, decimals: d.decimal ?? 3, klt, rows, src: '东财' };
}

export function getKline(code, klt = 101, lmt = 250, fqt = 0) {
  return cached(`kline:${code}:${klt}:${lmt}:${fqt}`, 300_000, async () => {
    const secid = toSecid(code);
    if (!secid) throw new Error('代码格式不对');
    try {
      return await txKline(code, klt, lmt);
    } catch (e) {
      // 腾讯挂了才回去试东财（目前东财必失败，所以平时不会白白等这几秒）
      return await emKline(code, klt, lmt, fqt);
    }
  });
}

/* ---------------- 3) 资金流（日线） ---------------- */

export function getFlow(code, lmt = 120) {
  return cached(`flow:${code}:${lmt}`, 300_000, async () => {
    const secid = toSecid(code);
    if (!secid) throw new Error('代码格式不对');
    // 资金流走 'flow' 通道（push2delay 的 fflow 还活着），别用 'his' —— 那边全被掐了
    const j = await emJson(
      'flow',
      `/api/qt/stock/fflow/daykline/get?secid=${secid}&lmt=${lmt}&klt=101` +
        '&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65'
    );
    const d = j && j.data;
    if (!d || !Array.isArray(d.klines)) throw new Error('资金流为空');
    // 日期,主力净额,小单净额,中单净额,大单净额,超大单净额,主力净占比,...,收盘价,涨跌幅
    const fresh = d.klines.map((line) => {
      const p = line.split(',');
      return {
        t: p[0],
        main: +p[1],
        small: +p[2],
        mid: +p[3],
        big: +p[4],
        huge: +p[5],
        mainPct: +p[6],
        close: +p[11],
      };
    });
    // 只给 1 天时不覆盖盘上的历史：合并后返回，曲线才不会塌成一根柱子
    const all = mergeByDate(flowRead(code), fresh);
    if (all.length) flowWrite(code, all);
    return all.slice(-lmt);
  });
}

/* ---------------- 4) 官方净值（算溢价率用） ---------------- */

async function fetchNavPage(code, pageIndex) {
  const t = await httpGet(
    `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=${pageIndex}&pageSize=20`,
    { referer: `https://fundf10.eastmoney.com/jjjz_${code}.html`, jsonp: true }
  );
  const o = JSON.parse(t);
  const list = (o && o.Data && o.Data.LSJZList) || [];
  return list.map((r) => ({
    date: r.FSRQ,
    nav: Number(r.DWJZ),
    accNav: Number(r.LJJZ),
    dailyPct: Number(r.JZZZL),
  })).filter((r) => r.date && Number.isFinite(r.nav));
}

/* 净值也落盘：东财 pageSize 硬上限 20，120 个交易日要串行走 6 页 × ~1.5s ≈ 9s，
   这是首屏最慢的一项。盘上有存量后，翻页遇到已缓存的日期就停，通常 1 页搞定。
   做法与 n225 的 nav_513880.json 一致（那边实测把 68s 降到 2.6s）。 */
const navFile = (code) => path.join(FLOW_DIR, `nav_${String(code)}.json`);

function navRead(code) {
  try {
    const v = JSON.parse(fs.readFileSync(navFile(code), 'utf8'));
    return new Map((Array.isArray(v) ? v : []).filter((r) => r && r.date).map((r) => [r.date, r]));
  } catch {
    return new Map();
  }
}

function navWrite(code, rows) {
  try {
    fs.mkdirSync(FLOW_DIR, { recursive: true });
    const f = navFile(code);
    fs.writeFileSync(f + '.tmp', JSON.stringify(rows));
    fs.renameSync(f + '.tmp', f);
  } catch {
    /* 同上，归档失败不影响主流程 */
  }
}

/** 拉最近 days 个交易日的净值（东财 pageSize 硬上限 20，只能分页；带磁盘增量缓存） */
export function getNavHistory(code, days = 120) {
  return cached(`nav:${code}:${days}`, 3600_000, async () => {
    const disk = navRead(code);
    const MAXP = 15; // 最多 300 个交易日，再多就太慢了
    let fresh = 0;
    for (let i = 1; i <= MAXP; i++) {
      const part = await fetchNavPage(code, i);
      if (!part.length) break;
      let addedHere = 0;
      for (const r of part) {
        if (disk.has(r.date)) continue; // 盘上有了就用盘上的，不再重复存
        disk.set(r.date, r);
        addedHere++;
      }
      fresh += addedHere;
      // 整页都是已有数据 = 已经追平，再往后翻也不会有新东西。
      // 少了这个判断，盘上数据完整时会一路翻满 15 页，白白多花 20 秒。
      if (addedHere === 0) break;
      if (fresh >= days) break;
    }
    const rows = [...disk.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (rows.length) navWrite(code, rows.slice(-400));
    return rows.slice(-days);
  });
}

/* ---------------- 5) 基金概况（天天基金 f10 概况页） ---------------- */

const INFO_LABELS = [
  '基金全称',
  '基金类型',
  '发行日期',
  '成立日期/规模',
  '净资产规模',
  '份额规模',
  '基金管理人',
  '基金托管人',
  '基金经理人',
  '管理费率',
  '托管费率',
  '销售服务费率',
  '最高认购费率',
  '业绩比较基准',
  '跟踪标的',
];

export function getFundInfo(code) {
  return cached('info:' + code, 86_400_000, async () => {
    const html = await httpGet(`https://fundf10.eastmoney.com/jbgk_${code}.html`, {
      referer: 'https://fundf10.eastmoney.com/',
    });
    const txt = html.replace(/<[^>]+>/g, '|').replace(/\|{2,}/g, '|').replace(/\s+/g, ' ');
    const out = {};
    for (const label of INFO_LABELS) {
      const i = txt.indexOf(label + '|');
      if (i < 0) continue;
      const rest = txt.slice(i + label.length + 1);
      const v = rest.slice(0, rest.indexOf('|')).trim();
      if (v && v !== '---' && v !== '|') out[label] = v;
    }
    return out;
  });
}

/* ---------------- 6) 溢价率（净值口径） ---------------- */

/**
 * 溢价率 = (价格 − 单位净值) / 单位净值。
 * 历史序列用「当日收盘价 vs 当日净值」对齐日期；实时值用「现价 vs 最新净值」。
 * QDII 的净值 T+1/T+2 才出，所以溢价里混着「净值滞后」这一项，页面必须标注净值日期。
 */
export async function getPremium(code, days = 120) {
  const [nav, kl] = await Promise.all([
    getNavHistory(code, days).catch(() => []),
    getKline(code, 101, Math.max(days + 30, 250), 0).catch(() => ({ rows: [] })),
  ]);
  const closeByDate = new Map(kl.rows.map((r) => [r.t, r.c]));
  const series = [];
  for (const n of nav) {
    const c = closeByDate.get(n.date);
    if (c == null) continue;
    series.push({ date: n.date, nav: n.nav, close: c, premium: ((c - n.nav) / n.nav) * 100 });
  }
  const vals = series.map((s) => s.premium);
  const sorted = [...vals].sort((a, b) => a - b);
  const quantile = (q) => {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  const latestNav = nav.length ? nav[nav.length - 1] : null;
  const q = await getQuote(code).catch(() => null);
  const livePremium =
    latestNav && q && q.price != null ? ((q.price - latestNav.nav) / latestNav.nav) * 100 : null;
  const cur = livePremium ?? (vals.length ? vals[vals.length - 1] : null);
  const pct = (v) => {
    if (!sorted.length || v == null) return null;
    return (sorted.filter((x) => x <= v).length / sorted.length) * 100;
  };
  return {
    asOf: latestNav ? latestNav.date : null,
    nav: latestNav ? latestNav.nav : null,
    premium: cur,
    live: livePremium != null,
    median: quantile(0.5),
    p25: quantile(0.25),
    p75: quantile(0.75),
    p90: quantile(0.9),
    min: sorted.length ? sorted[0] : null,
    max: sorted.length ? sorted[sorted.length - 1] : null,
    percentile: pct(cur),
    samples: series.length,
    series, // 供画图
  };
}

/* ---------------- 7) ETF 全市场列表（搜索用） ---------------- */

let listCache = { t: 0, v: [] };
let listRefreshing = false;

/* ETF 全市场列表落盘：17 页 × ~2s，冷拉一次要 30~60 秒，重启后不保留的话
   每 6 小时就要让用户干等一次。策略是 stale-while-revalidate：盘上有就直接返回，
   过期了就后台默默刷新，绝不让搜索请求自己卡在那儿等。 */
const listFile = () => path.join(FLOW_DIR, 'etf_list.json');

function listRead() {
  try {
    const o = JSON.parse(fs.readFileSync(listFile(), 'utf8'));
    return { t: Number(o.t) || 0, v: Array.isArray(o.v) ? o.v : [] };
  } catch {
    return { t: 0, v: [] };
  }
}

function listWrite(v) {
  try {
    const f = listFile();
    fs.writeFileSync(f + '.tmp', JSON.stringify({ t: Date.now(), v }));
    fs.renameSync(f + '.tmp', f);
  } catch {
    /* 同上 */
  }
}

const SINA_REF = 'https://finance.sina.com.cn';

/** 新浪 ETF 全市场列表。硬限 100 条/页，实测共 1685 只 → 17 页，5 个一批并发约 6 秒。
    注意：不带 Referer 会被 403。 */
async function sinaAllETF() {
  const url = (pn) =>
    `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${pn}` +
    '&num=100&sort=symbol&asc=1&node=etf_hq_fund';
  const pick = (a) =>
    (Array.isArray(a) ? a : []).map((it) => ({
      code: String(it.code || '').trim(),
      market: String(it.symbol || '').startsWith('sh') ? '1' : '0',
      name: it.name || '',
      price: num(it.trade),
      chgPct: num(it.changepercent),
    }));

  const first = JSON.parse(await httpGet(url(1), { timeout: 15000, referer: SINA_REF }));
  const out = pick(first);
  if (!out.length) throw new Error('新浪 ETF 列表为空');
  const MAXP = 25;
  const CONC = 3; // 新浪对并发敏感，5 个一批试过会拖到超时，3 个稳一些
  for (let p = 2; p <= MAXP; p += CONC) {
    const batch = [];
    for (let i = p; i < Math.min(p + CONC, MAXP + 1); i++) batch.push(i);
    const res = await Promise.all(
      batch.map((pn) =>
        httpGet(url(pn), { timeout: 15000, referer: SINA_REF }).then(JSON.parse).catch(() => null)
      )
    );
    let got = 0;
    for (const a of res) {
      const rows = pick(a);
      if (rows.length) {
        out.push(...rows);
        got += rows.length;
      }
    }
    if (!got) break; // 翻到空页就停，别硬跑满 25 页
  }
  return out;
}

/** 东财版（旧主源）。2026-09-25 晚 clist 全系列 502，降为兜底。 */
async function emAllETF() {
  const fs = 'b:MK0021,b:MK0022,b:MK0023,b:MK0024'; // 股票型/跨境/债券/商品 ETF
  const url = (pn) =>
    `/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}` +
    '&fields=f1,f2,f3,f12,f13,f14,f6';
  const pick = (d) =>
    (d.diff || []).map((it) => ({
      code: String(it.f12),
      market: it.f13,
      name: it.f14 || '',
      price: num(it.f2),
      chgPct: num(it.f3),
    }));

  // 东财单次最多给 100 条，1600+ 只 ETF 要翻 17 页；串行要 30 秒，所以 5 个一批并发拉
  const first = await emJson('quote', url(1));
  const d0 = first && first.data;
  if (!d0 || !Array.isArray(d0.diff)) throw new Error('ETF列表为空');
  const out = pick(d0);
  const total = d0.total || 0;
  const pages = Math.min(25, Math.ceil(total / 100));
  for (let p = 2; p <= pages; p += 5) {
    const batch = [];
    for (let i = p; i < Math.min(p + 5, pages + 1); i++) batch.push(i);
    const res = await Promise.all(batch.map((pn) => emJson('quote', url(pn)).catch(() => null)));
    for (const j of res) {
      const d = j && j.data;
      if (d && Array.isArray(d.diff)) out.push(...pick(d));
    }
  }
  return out;
}

async function fetchAllETF() {
  let err;
  for (const fn of [sinaAllETF, emAllETF]) {
    try {
      return await fn();
    } catch (e) {
      err = e;
    }
  }
  throw err || new Error('ETF 列表全部数据源不可达');
}

export async function searchETF(q, limit = 20) {
  const key = String(q || '').trim();
  if (!key) return [];
  if (!listCache.v.length) listCache = listRead(); // 内存没有就先从盘上恢复
  const stale = Date.now() - listCache.t > 6 * 3600_000;
  if (stale && !listRefreshing) {
    // 过期了就在后台刷新，这次请求照常用旧列表回答
    listRefreshing = true;
    fetchAllETF()
      .then((v) => {
        if (v.length) {
          listCache = { t: Date.now(), v };
          listWrite(v);
        }
      })
      .catch(() => {})
      .finally(() => {
        listRefreshing = false;
      });
  }
  if (!listCache.v.length) {
    // 盘上也没有（首次部署），只能同步等一次——只会有这一次
    const v = await fetchAllETF();
    listCache = { t: Date.now(), v };
    listWrite(v);
  }
  const k = key.toLowerCase();
  const hit = listCache.v.filter((x) => x.code.includes(key) || (x.name || '').toLowerCase().includes(k));
  return hit.slice(0, limit);
}

/* ---------------- 8) 一次拿全（页面首屏） ---------------- */

export async function getSnapshot(code, opts = {}) {
  const days = Math.min(300, Math.max(60, Number(opts.days) || 120));
  const [quote, kline, premium, flow, info] = await Promise.all([
    getQuote(code).catch((e) => ({ error: e.message })),
    getKline(code, 101, 300, 0).catch((e) => ({ error: e.message, rows: [] })),
    getPremium(code, days).catch((e) => ({ error: e.message, series: [] })),
    getFlow(code, 120).catch(() => []),
    getFundInfo(code).catch(() => ({})),
  ]);
  return { code, quote, kline, premium, flow, info, fetchedAt: Date.now() };
}
