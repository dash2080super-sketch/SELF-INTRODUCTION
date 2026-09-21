/**
 * dividend50 —— 红利 50 专区（典范标的 515450）的评估与建议引擎。
 *
 * 与 dividend（个股高股息）的区别：
 *   1. 标的是 ETF，东财「分红送转」表里查不到 ETF 派息 → 派息日历在下面手动维护
 *      （一年改两三次，来源是基金公告，页面上会明写"手动维护，截至哪天"）。
 *   2. 除了「买不买」，还要回答「卖不卖」——所以建议是双向六档，带强度。
 *   3. 口径分裂是本专区最大的坑：ETF 实际派息算出来的股息率（约 3.9%）
 *      和指数口径股息率（4.2%~4.5%）不是一回事，两个都给，各自标来源。
 *
 * 数据：腾讯行情 / 腾讯 K 线 / 中债国债曲线（全部复用 dividend-data.js）。
 */
import { fetchQuotes, fetchKline, fetchAnchor, boll } from './dividend-data.js';

/* ============================================================
   一、标的档案与参数（要改就改这里）
   ============================================================ */
export const D50 = {
  code: '515450',
  name: '红利低波50ETF南方',
  indexName: '标普中国A股大盘红利低波50指数',
  indexCode: 'SPCLLHCP.SPI',
  inception: '2020-01-17',
  fee: '管理费 0.50% + 托管费 0.10%',
  connect: '场外联接 A 008163 / C 008164',

  /** ETF 每份派息（元）。来源：基金分红公告。⚠️ 手动维护，一年动两三次。 */
  payout: [
    { exDate: '2025-12-15', perShare: 0.03 },
    { exDate: '2026-07-15', perShare: 0.01 },
    { exDate: '2026-09-09', perShare: 0.015 },
  ],
  payoutAsOf: '2026-09-21',

  /** 指数侧口径（手动维护，不同来源分歧很大，这里给区间 + 时点） */
  index: {
    asOf: '2026-09-18',
    peTtm: [8.6, 9.0],
    pePercentile: [55.8, 77],
    pb: 0.88,
    yieldRange: [4.19, 4.47],
    src: 'Wind 整体法 / 标普道琼斯 / 第三方温度计；三家口径不一致，需核实原文',
  },

  /** 策略参数 */
  strategy: {
    /** 股债利差（百分点）分档：越大越便宜 */
    spread: {
      strong: 3.0, // ≥ 3.0 且日周月共振 → 强烈买入
      buy: 3.0, // ≥ 3.0 且技术位置到位 → 买入
      small: 2.5, // ≥ 2.5 且日线到位 → 小额买入
      thin: 1.5, // < 1.5 → 减仓
      sell: 1.2, // < 1.2 且价格在通道上沿 → 卖出
    },
    /** 布林带 */
    boll: { period: 20, std: 2, dayIn: 3, dayNear: 5, wmIn: 5, wmNear: 8 },
    /** 拥挤度：近 5 日均量 ÷ 近 20 日均量 */
    crowd: { hot: 1.3, cold: 0.8 },
    /** 网格档位：目标股息率 = 十年国债 + 该利差 */
    ladder: [2.5, 3.0, 3.3, 3.6, 4.0],
  },
};

/* ============================================================
   二、六档建议（含强度）
   ============================================================ */
export const ACTIONS = {
  strong: {
    key: 'strong',
    label: '强烈买入',
    strength: 5,
    cls: 'd50-strong',
    /** 机动仓本次投入比例（负=卖出） */
    positionPct: 100,
    tone: '利差厚 + 日周月三周期技术位置同时到位，这是金字塔最下面、也是最重的那一层。',
    do: '机动仓可一次性投满。底仓不动，之后每季度再平衡。',
  },
  buy: {
    key: 'buy',
    label: '买入',
    strength: 4,
    cls: 'd50-buy',
    positionPct: 60,
    tone: '利差达标，技术位置到位，但还没到三周期共振。',
    do: '机动仓投 60%，剩下的留给更便宜的下一档。',
  },
  small: {
    key: 'small',
    label: '小额买入',
    strength: 3,
    cls: 'd50-small',
    positionPct: 30,
    tone: '补偿还行、短线位置也到了，但不够厚——属于"可以先铺一点"。',
    do: '机动仓投 30%。别因为它比"买入"弱就不投，金字塔本来就是分层的。',
  },
  wait: {
    key: 'wait',
    label: '等待',
    strength: 2,
    cls: 'd50-wait',
    positionPct: 0,
    tone: '估值条件成立、但技术位置还没进买点区，或者反过来。缺一条腿。',
    do: '不投机动仓，只按纪律定投底仓。把资金准备好，等两条腿都到位。',
  },
  hold: {
    key: 'hold',
    label: '持有观望',
    strength: 1,
    cls: 'd50-hold',
    positionPct: 0,
    tone: '不便宜也不贵，补偿中等。这个区间最该做的事是"什么都不做"。',
    do: '底仓照常持有收息，机动仓不加。追进去赚不到价差，还占用子弹。',
  },
  trim: {
    key: 'trim',
    label: '减仓',
    strength: -1,
    cls: 'd50-trim',
    positionPct: -50,
    tone: '股息补偿已经变薄，红利相对国债的优势在消失。',
    do: '机动仓减半。底仓可以留着继续收息，不必清仓。',
  },
  sell: {
    key: 'sell',
    label: '卖出',
    strength: -2,
    cls: 'd50-sell',
    positionPct: -100,
    tone: '补偿极薄、价格还顶在布林带上沿——贵且热，这是唯一值得主动卖的组合。',
    do: '清掉机动仓。底仓是否留看你的持有目的：只为收息可以留，为价差的别留。',
  },
  nodata: {
    key: 'nodata',
    label: '数据不足',
    strength: 0,
    cls: 'd50-dim',
    positionPct: 0,
    tone: '必要数据缺失，不生成信号。猜出来的建议比没有建议更糟。',
    do: '刷新重试；若持续失败，看页面上标红的那一项是哪个源挂了。',
  },
};

/* ============================================================
   三、小工具
   ============================================================ */
function ttmPayout(payout, now = new Date()) {
  const from = new Date(now.getTime() - 365 * 86400_000);
  const hit = payout.filter((p) => new Date(p.exDate + 'T00:00:00Z') >= from);
  const total = hit.reduce((a, p) => a + p.perShare, 0);
  return { total: +total.toFixed(4), count: hit.length, parts: hit };
}

/** 价格距某条轨的百分比（正=在轨上方） */
function dev(price, line) {
  if (!Number.isFinite(line) || !line || price == null) return null;
  return +(((price - line) / line) * 100).toFixed(2);
}

/** 位置分档：in（到位）/ near（临近）/ out（没到） */
function bandState(pct, inPct, nearPct) {
  if (pct == null) return { state: 'na', pct: null };
  if (pct <= inPct) return { state: 'in', pct };
  if (pct <= nearPct) return { state: 'near', pct };
  return { state: 'out', pct };
}

function mean(arr) {
  if (!arr?.length) return null;
  return arr.reduce((a, c) => a + c, 0) / arr.length;
}

/* ============================================================
   四、评级
   ============================================================ */
function decide({ spread, d, w, m, devUpper, missing }) {
  if (missing.length) return ACTIONS.nodata;
  const S = D50.strategy.spread;

  // 先判断要不要卖：补偿薄 + 价格顶在上沿
  if (spread != null && spread < S.sell && devUpper != null && devUpper > -2) return ACTIONS.sell;
  if (spread != null && spread < S.thin) return ACTIONS.trim;

  const dOk = d === 'in' || d === 'near';
  const wmOk = w === 'in' || w === 'near' || m === 'in' || m === 'near';

  if (spread != null && spread >= S.strong && d === 'in' && wmOk) return ACTIONS.strong;
  if (spread != null && spread >= S.buy && dOk && wmOk) return ACTIONS.buy;
  if (spread != null && spread >= S.small && dOk) return ACTIONS.small;
  if (spread != null && spread >= S.small) return ACTIONS.wait; // 估值到了，位置没到
  return ACTIONS.hold;
}

/** 距离下一档还差多少（利差口径，百分点） */
function nextStep(spread) {
  if (spread == null) return null;
  const S = D50.strategy.spread;
  if (spread < S.sell) return { target: '回到减仓档以上', need: +(S.thin - spread).toFixed(2) };
  if (spread < S.thin) return { target: '减仓 → 持有观望', need: +(S.thin - spread).toFixed(2) };
  if (spread < S.small) return { target: '持有观望 → 小额买入（还要技术位置到位）', need: +(S.small - spread).toFixed(2) };
  if (spread < S.buy) return { target: '小额买入 → 买入', need: +(S.buy - spread).toFixed(2) };
  return { target: '已在最高档，剩下的只看技术位置', need: 0 };
}

/* ============================================================
   五、主入口
   ============================================================ */
let cache = null; // { at, value }
const TTL = 30_000;

export async function getDividend50({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.value;

  const c = D50.code;
  const missing = [];

  const [quoteMap, anchor, dayBars, weekBars, monthBars] = await Promise.all([
    fetchQuotes([c]).catch(() => ({})),
    fetchAnchor().catch(() => null),
    fetchKline(c, 'day').catch(() => []),
    fetchKline(c, 'week').catch(() => []),
    fetchKline(c, 'month').catch(() => []),
  ]);

  const q = quoteMap[c] || null;
  if (!q) missing.push('实时行情');
  if (!anchor) missing.push('国债收益率锚');
  if (!dayBars?.length) missing.push('日线');
  if (!weekBars?.length) missing.push('周线');
  if (!monthBars?.length) missing.push('月线');

  const price = q?.price ?? null;
  const y10 = anchor?.y10 ?? null;

  /* --- 股息率（ETF 实际派息口径） --- */
  const ttm = ttmPayout(D50.payout);
  const yieldTtm = price && ttm.total ? +((ttm.total / price) * 100).toFixed(2) : null;
  const spread = yieldTtm != null && y10 != null ? +(yieldTtm - y10).toFixed(2) : null;

  /* --- 技术位置 --- */
  const B = D50.strategy.boll;
  const bDay = boll(dayBars, B.period, B.std);
  const bWeek = boll(weekBars, B.period, B.std);
  const bMonth = boll(monthBars, B.period, B.std);

  const dLow = dev(price, bDay?.lower);
  const wLow = dev(price, bWeek?.lower);
  const mLow = dev(price, bMonth?.lower);
  const dUp = dev(price, bDay?.upper);

  const tech = {
    day: bandState(dLow, B.dayIn, B.dayNear),
    week: bandState(wLow, B.wmIn, B.wmNear),
    month: bandState(mLow, B.wmIn, B.wmNear),
    upperPct: dUp,
  };

  /* --- 拥挤度：近 5 日均量 ÷ 近 20 日均量 --- */
  const vols = (dayBars || []).map((b) => b.vol).filter(Number.isFinite);
  const v5 = mean(vols.slice(-5));
  const v20 = mean(vols.slice(-20));
  const crowdRatio = v5 && v20 ? +(v5 / v20).toFixed(2) : null;
  const crowd =
    crowdRatio == null
      ? { state: 'na', label: '无数据', ratio: null }
      : crowdRatio >= D50.strategy.crowd.hot
        ? { state: 'hot', label: '偏热', ratio: crowdRatio }
        : crowdRatio <= D50.strategy.crowd.cold
          ? { state: 'cold', label: '清淡', ratio: crowdRatio }
          : { state: 'normal', label: '正常', ratio: crowdRatio };

  /* --- 回撤：距近一年最高收盘 --- */
  let drawdown = null;
  if (price && dayBars?.length) {
    const highs = dayBars.map((b) => b.high || b.close).filter(Number.isFinite);
    const peak = Math.max(...highs);
    if (peak > 0) drawdown = +(((price - peak) / peak) * 100).toFixed(2);
  }

  /* --- 指数口径（手动快照） --- */
  const idx = D50.index;
  const idxSpread =
    y10 != null ? +(idx.yieldRange[1] - y10).toFixed(2) : null;

  /* --- 网格：目标价 = 每份派息 ÷ 目标股息率 --- */
  const grid = (D50.strategy.ladder || []).map((lv) => {
    if (y10 == null || !ttm.total) return { spread: lv, targetYield: null, price: null };
    const ty = +(y10 + lv).toFixed(2);
    const tp = +(ttm.total / (ty / 100)).toFixed(3);
    return {
      spread: lv,
      targetYield: ty,
      price: tp,
      hit: price != null ? price <= tp : null,
      gapPct: price != null ? +(((price - tp) / tp) * 100).toFixed(2) : null,
    };
  });

  /* --- 定档 --- */
  const action = decide({
    spread,
    d: tech.day.state,
    w: tech.week.state,
    m: tech.month.state,
    devUpper: dUp,
    missing,
  });

  const out = {
    fund: {
      code: D50.code,
      name: D50.name,
      indexName: D50.indexName,
      indexCode: D50.indexCode,
      inception: D50.inception,
      fee: D50.fee,
      connect: D50.connect,
    },
    price,
    chgPct: q?.chgPct ?? null,
    turnoverPct: q?.turnoverPct ?? null,
    quoteAt: q?.at ?? null,
    payout: { ttm: ttm.total, count: ttm.count, parts: ttm.parts, asOf: D50.payoutAsOf },
    yieldTtm,
    anchor: anchor ? { y10: anchor.y10, date: anchor.date, src: anchor.src } : null,
    spread,
    index: {
      ...idx,
      spread: idxSpread,
    },
    boll: { day: bDay, week: bWeek, month: bMonth },
    tech,
    crowd,
    drawdown,
    grid,
    action,
    next: nextStep(spread),
    missing,
    strategy: D50.strategy,
    actions: ACTIONS,
    generatedAt: Date.now(),
  };

  cache = { at: Date.now(), value: out };
  return out;
}

export function invalidate50() {
  cache = null;
}
