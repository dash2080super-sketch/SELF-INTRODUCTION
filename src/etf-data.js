/**
 * etf-data —— ETF / 场内标的行情数据源（纯抓取 + 缓存，不含路由）。
 *
 * 数据源全是东方财富。三个坑，写在这里免得以后再踩：
 *  1. 海外 IP 访问 push2.eastmoney.com 会被 302 到 push2delay（延时行情节点），
 *     Node 的 fetch 跟跳转时不时直接 fetch failed —— 所以首选 push2delay，push2 兜底。
 *  2. push2his.eastmoney.com（K 线 / 资金流）在部分网络下 https 直接被掐断，
 *     但 63.push2his / http 明文都能通。这里做了「首次轮询 + 记住可用域名」。
 *  3. 东财的 f71 不是 IOPV，是当日均价（实测 f71 ≈ 成交额/成交量，恒等于均价）。
 *     单股接口里根本没有 IOPV 字段，所以溢价率一律用「最新官方单位净值」口径算，
 *     并在页面上标出净值日期（QDII 净值滞后 1~2 天，溢价会被系统性放大，必须注明）。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 候选域名：按顺序试，成功那个记下来下次优先用 */
const HOSTS = {
  quote: ['https://push2delay.eastmoney.com', 'https://push2.eastmoney.com'],
  his: [
    'https://63.push2his.eastmoney.com',
    'http://push2his.eastmoney.com',
    'https://push2his.eastmoney.com',
  ],
};
const goodHost = { quote: null, his: null };

/* ---------------- 基础 HTTP ---------------- */

async function httpGet(url, { timeout = 12000, referer, jsonp = false } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
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
  const order = goodHost[kind] ? [goodHost[kind], ...HOSTS[kind].filter((h) => h !== goodHost[kind])] : HOSTS[kind];
  let lastErr;
  for (const base of order) {
    try {
      const t = await httpGet(base + path, { referer });
      if (!t || t.length < 10) throw new Error('empty response');
      goodHost[kind] = base;
      return t;
    } catch (e) {
      lastErr = e;
    }
  }
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

export function getQuote(code) {
  return cached('quote:' + code, 10_000, async () => {
    const secid = toSecid(code);
    if (!secid) throw new Error('代码格式不对，需要 6 位数字');
    const j = await emJson('quote', `/api/qt/stock/get?secid=${secid}&fltt=2&invt=2&fields=${QUOTE_FIELDS}`);
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
      volume: num(d.f47), // 手
      amount: num(d.f48), // 元
      turnoverRate: num(d.f168),
      volRatio: num(d.f50),
      scale: num(d.f116), // 流通市值 ≈ 实时规模（元）
      listingDate: d.f189 ? String(d.f189) : null,
      ts: num(d.f86),
    };
  });
}

/* ---------------- 2) K 线 ---------------- */

/** klt: 101日 102周 103月 60/30/15/5 分钟 */
export function getKline(code, klt = 101, lmt = 250, fqt = 0) {
  return cached(`kline:${code}:${klt}:${lmt}:${fqt}`, 300_000, async () => {
    const secid = toSecid(code);
    if (!secid) throw new Error('代码格式不对');
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
    return { name: d.name || '', code: d.code || code, decimals: d.decimal ?? 3, klt, rows };
  });
}

/* ---------------- 3) 资金流（日线） ---------------- */

export function getFlow(code, lmt = 120) {
  return cached(`flow:${code}:${lmt}`, 300_000, async () => {
    const secid = toSecid(code);
    if (!secid) throw new Error('代码格式不对');
    const j = await emJson(
      'his',
      `/api/qt/stock/fflow/daykline/get?secid=${secid}&lmt=${lmt}&klt=101` +
        '&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65'
    );
    const d = j && j.data;
    if (!d || !Array.isArray(d.klines)) throw new Error('资金流为空');
    // 日期,主力净额,小单净额,中单净额,大单净额,超大单净额,主力净占比,...,收盘价,涨跌幅
    return d.klines.map((line) => {
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

/** 拉最近 days 个交易日的净值（东财 pageSize 硬上限 20，只能分页） */
export function getNavHistory(code, days = 120) {
  return cached(`nav:${code}:${days}`, 3600_000, async () => {
    const pages = Math.min(15, Math.ceil(days / 20)); // 最多 300 个交易日，再多就太慢了
    const out = [];
    for (let i = 1; i <= pages; i++) {
      const part = await fetchNavPage(code, i);
      if (!part.length) break;
      out.push(...part);
      if (out.length >= days) break;
    }
    out.sort((a, b) => (a.date < b.date ? -1 : 1));
    return out.slice(-days);
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

async function fetchAllETF() {
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

export async function searchETF(q, limit = 20) {
  const key = String(q || '').trim();
  if (!key) return [];
  if (Date.now() - listCache.t > 6 * 3600_000 || !listCache.v.length) {
    const v = await fetchAllETF();
    if (v.length) listCache = { t: Date.now(), v };
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
