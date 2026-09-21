// 给 finance-catalog.js 加：① 新分区「风险偏好」（信用比价 / 市场广度 / 比特币）
// ② 全球股指里加台湾加权 ③ 顺延后面 5 个分区的编号 ④ 补 ratio 字段说明。
// 行号从底部往上应用；每处先校验锚点，任一不符就整体中止、不动文件。
import fs from 'node:fs';

const FILE = 'src/finance-catalog.js';

const RATIO_DOC = [
  ' *   ratio     派生比价 { num, den, scale, label }：把 num 腿 ÷ den 腿 × scale 当作展示值。',
  ' *             用于"比价本身才是信号"的指标（信用利差、市场广度）。取不到分母时自动退回显示原始两腿。',
];

const TWII = [
  '      {',
  "        id: 'twii',",
  "        name: '台湾加权指数',",
  "        en: 'Taiwan Weighted Index (TAIEX)',",
  "        legs: [{ label: '台湾加权', cnbc: '.TWII', yahoo: '^TWII' }],",
  '        dec: 2,',
  "        unit: '',",
  "        dir: 'up-good',",
  "        bands: [{ max: 1e9, label: 'AI 供应链最前线', c: B.calm }],",
  '        note: `台湾证券交易所加权股价指数。台积电一家就占了它约三分之一的权重，加上鸿海、联发科、广达，<b>它本质上是"AI 硬件供应链"的股价化</b>。',
  '<b>为什么它比 SOX 更贴近现实：</b>费城半导体指数是<b>股价</b>指数，会被估值和情绪放大；台湾加权背后是<b>真实的产能和出货</b>——先进制程代工、AI 服务器组装、封装测试基本都在台湾。所以当"AI 叙事"和"AI 实际订单"出现分歧时，台湾的走势更可信。',
  '<b>和纳指的关系：</b>台湾是全球 AI 供应链的上游，纳指七巨头是下游的采购方。上游先感受到订单变化，所以<b>台湾加权常常是纳指硬件行情的领先指标</b>——它先走弱而纳指还在涨，是值得警惕的背离。',
  '<b>额外观察点：</b>台湾是少数每月都公布<b>出口订单</b>和<b>上市公司月营收</b>的经济体，数据频率比欧美高。所以它不只是股价指标，还能用真实景气度交叉验证。',
  '<b>风险：</b>权重极度集中在电子业，加上海峡地缘因素，它有很强的"单一行业 + 单一风险"属性，不能当泛亚洲指数用（那个位置看 KOSPI 和 TOPIX）。`,',
  "        srcNote: 'TWSE · 实时',",
  '      },',
];

const NEW_ZONE = [
  '  /* ============================================================',
  '   * 二、风险偏好 —— 资金现在敢不敢冒险（信用 / 广度 / 加密三个角度）',
  '   * ============================================================ */',
  '  {',
  "    id: 'appetite',",
  "    name: '风险偏好',",
  "    icon: '⚖️',",
  "    desc: '回答一个问题：资金敢不敢冒险。信用（敢不敢借给差公司）、广度（敢不敢买小公司）、加密（敢不敢买纯流动性资产）——三个角度互相印证，一起转向才是真的转向。',",
  '    items: [',
  '      {',
  "        id: 'credit',",
  "        name: '信用风险偏好',",
  "        en: 'HYG / IEF (High Yield vs 7-10Y Treasury)',",
  '        legs: [',
  "          { label: 'HYG', yahoo: 'HYG' },",
  "          { label: 'IEF', yahoo: 'IEF' },",
  '        ],',
  "        ratio: { num: 'HYG', den: 'IEF', scale: 100, label: 'HYG/IEF' },",
  '        dec: 2,',
  "        unit: '',",
  "        dir: 'up-good',",
  "        bands: [{ max: 1e9, label: '资金敢不敢借给差公司', c: B.calm }],",
  '        note: `用高收益债 ETF（HYG）除以 7-10 年国债 ETF（IEF），再 ×100 便于阅读。',
  '<b>为什么它比 VIX 更值得看：</b>VIX 是"保险的报价"——恐慌时买保险的人多它就涨，但经常被短期对冲需求和期权供给扰动。信用比价是"真实的违约定价"——要让高收益债跑输国债，市场得真金白银地认为企业还不上钱。<b>信用先坏、股价后跌</b>是常态，2008 和 2020 年都是这个顺序。',
  '<b>怎么读：</b>比价下行 ＝ 资金从信用债撤向国债 ＝ 风险偏好在退。要区分两种下行——温和阴跌（周跌幅 <1%）属正常周期波动，别过度解读；连续大幅下行且伴随 VIX 跳升，是信用事件的前兆，<b>优先级高于任何指数跌幅</b>。',
  '<b>和 VIX 背离时最有价值：</b>VIX 涨但比价不动，通常只是期权市场的技术性对冲；比价跌但 VIX 不涨，说明机构在<b>悄悄降低信用敞口而不买保险</b>——这种"安静的去风险"最容易被忽略。`,',
  "        srcNote: 'Yahoo Finance（ETF 现价，比值由本站计算）',",
  '      },',
  '      {',
  "        id: 'breadth',",
  "        name: '市场广度',",
  "        en: 'RSP / SPY (Equal Weight vs Cap Weight)',",
  '        legs: [',
  "          { label: 'RSP', yahoo: 'RSP' },",
  "          { label: 'SPY', yahoo: 'SPY' },",
  '        ],',
  "        ratio: { num: 'RSP', den: 'SPY', scale: 100, label: 'RSP/SPY' },",
  '        dec: 2,',
  "        unit: '',",
  "        dir: 'up-good',",
  "        bands: [{ max: 1e9, label: '上涨是普涨还是少数股在拉', c: B.calm }],",
  '        note: `标普 500 的等权版本（RSP）除以市值加权版本（SPY），再 ×100。',
  '<b>它替代了原来那个手动项：</b>本站原本用麦克莱伦摆动指标看广度，但它要手工录入，实际上常年是空的。这个比价能自动算出来，直接补上这个位置。',
  '<b>它衡量什么：</b>SPY 里前十大权重股占了近四成，所以指数涨可能只是那七八只在涨。RSP 每只股票权重一样，必须"多数股票都在涨"才会涨。所以<b>比价上行 ＝ 上涨是普遍的（健康），比价下行 ＝ 只是大票在拉指数（虚涨）</b>。',
  '<b>为什么对纳斯达克尤其重要：</b>纳指 100 的集中度比标普还极端。如果 NDX 创新高而 RSP/SPY 在跌，这波新高就是少数 AI 权重股撑的，它们一回头指数没有支撑。',
  '<b>注意：</b>它不是择时信号，但会显著降低你在高位加仓的合理性——指数与广度背离是历史上最常见的顶部特征之一。`,',
  "        srcNote: 'Yahoo Finance（ETF 现价，比值由本站计算）',",
  '      },',
  '      {',
  "        id: 'btc',",
  "        tier: 'fast',",
  "        name: '比特币',",
  "        en: 'Bitcoin / CME Bitcoin Futures',",
  '        legs: [',
  "          { label: '现货', yahoo: 'BTC-USD' },",
  "          { label: 'CME 期货', cnbc: '@BTC.1' },",
  '        ],',
  '        dec: 0,',
  "        unit: '$',",
  "        dir: 'up-good',",
  "        bands: [{ max: 1e9, label: '最纯粹的风险偏好探针', c: B.calm }],",
  '        note: `<b>为什么放在"风险偏好"而不是单开一个加密货币分区：</b>它不产生现金流、没有估值锚、不受任何央行保护，所以它的价格几乎是<b>纯流动性和纯风险偏好的读数</b>——涨不代表它有价值，代表市场上的钱多而且愿意冒险。没有别的资产这么纯粹。',
  '<b>和纳指的关系：</b>2020 年以后比特币与纳指的相关性显著上升，两者背后是同一件事——<b>美元流动性的松紧</b>。所以看 NDX 时它是很好的确认变量：纳指涨 + 比特币同步涨 ＝ 流动性驱动（可持续性较强）；纳指涨但比特币不涨甚至跌 ＝ 只是个别板块的资金轮动（可持续性弱）。',
  '<b>它的独特价值在两个极端：</b>极度宽松时它涨得比任何指数都快，流动性一收紧它跌得也最快。它是<b>流动性的放大器，不是滞后指标</b>。',
  '<b>别过度解读：</b>单日 ±5% 是常态，日线噪声极大；它还有自己的行业事件（监管、交易所、ETF 资金流），会出现与宏观无关的独立行情。看周线趋势，别盯单日。`,',
  "        srcNote: 'Coinbase / CME · 实时',",
  '      },',
  '    ],',
  '  },',
  '',
];

// 编号顺延：因为新分区插在「一、情绪与仓位」后面，原来的二~六要变成三~七
const RENUM = [
  { line: 627, expect: '六、外汇', map: ['六', '七'] },
  { line: 548, expect: '五、利率', map: ['五', '六'] },
  { line: 410, expect: '四、全球股指', map: ['四', '五'] },
  { line: 313, expect: '三、美股', map: ['三', '四'] },
  { line: 168, expect: '二、波动率', map: ['二', '三'] },
];

const ops = [
  ...RENUM,
  { line: 472, expectNext: "id: 'hsi'", before: TWII },
  { line: 167, expectNext: '二、波动率', before: NEW_ZONE },
  { line: 11, expect: 'manual', after: RATIO_DOC },
].sort((a, b) => (b.end || b.line) - (a.end || a.line));

const lines = fs.readFileSync(FILE, 'utf8').split('\n');

for (const op of ops) {
  const got = lines[op.line - 1];
  if (got === undefined) throw new Error(`第 ${op.line} 行不存在（文件只有 ${lines.length} 行）`);
  if (op.expect && !got.includes(op.expect)) {
    throw new Error(`第 ${op.line} 行锚点不符\n  期望含: ${op.expect}\n  实际:   ${got}`);
  }
  if (op.expectNext) {
    const nxt = lines[op.line] ?? '';
    if (!nxt.includes(op.expectNext)) {
      throw new Error(`第 ${op.line + 1} 行锚点不符\n  期望含: ${op.expectNext}\n  实际:   ${nxt}`);
    }
  }
}

for (const op of ops) {
  const idx = op.line - 1;
  const endIdx = op.end ? op.end - 1 : idx;
  let repl;
  if (op.map) {
    const [from, to] = op.map;
    const j = lines[idx].indexOf(from + '、');
    if (j < 0) throw new Error(`第 ${op.line} 行找不到编号 ${from}、`);
    repl = [lines[idx].slice(0, j) + to + lines[idx].slice(j + 1)];
  } else {
    repl = [lines[idx]];
  }
  const out = [];
  if (op.before) out.push(...op.before);
  out.push(...repl);
  if (op.after) out.push(...op.after);
  lines.splice(idx, endIdx - idx + 1, ...out);
}

fs.writeFileSync(FILE, lines.join('\n'), 'utf8');
console.log(`✅ ${FILE} 补丁已应用（${ops.length} 处），现在 ${lines.length} 行`);
