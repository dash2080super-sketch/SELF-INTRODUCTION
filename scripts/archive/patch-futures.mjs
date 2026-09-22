// 按行号给 finance-data.js / finance-catalog.js 打补丁：加 DAX、TOPIX 期货（TradingView 源）。
// 行号从底部往上应用，避免错位。每处先校验锚点行，不对就整体中止。
import fs from 'node:fs';

const ops = {
  'src/finance-data.js': [
    { line: 25, end: 26, replace: [
      ' * 源策略：每条腿声明 cnbc / yahoo / tv 三个候选。先走 CNBC 批量（一次 8 个符号），',
      ' * 拿不到或变化为 UNCH 才回落 Yahoo 单查；CNBC、Yahoo 都没有的期货腿（DAX、TOPIX）',
      ' * 走 tv（TradingView 公开端点，约 15 分钟延迟）。单个源挂掉只降级，不会整片空白。',
    ] },
    { line: 33, expect: 'const YAHOO_CONCURRENCY = 6;', replace: [
      'const YAHOO_CONCURRENCY = 6;',
      'const TV_CONCURRENCY = 4;',
    ] },
    { line: 118, expect: 'yahoo: leg.yahoo || null,', after: ['        tv: leg.tv || null,'] },
    { line: 199, expect: 'async function mapLimit', before: [
      '/* ---------------- TradingView 公开端点（期货兜底） ---------------- */',
      '// CNBC / Yahoo 都没有 DAX、TOPIX 期货，只有这里拿得到。',
      '// 返回的是延迟数据（update_mode = delayed_streaming_900，约 15 分钟），',
      '// 判断隔夜欧洲 / 日本盘的方向够用，别拿它做交易触发。',
      'async function fetchTradingView(symbol) {',
      "  const url =",
      "    `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(symbol)}` +",
      "    '&fields=close,change,currency,description,update_mode&no_404=true';",
      '  countRequest();',
      '  const j = await getJSON(url);',
      '  const price = num(j?.close);',
      "  if (price == null) throw new Error('no close');",
      '  const chgPct = num(j?.change);',
      '  // change 本身就是百分比，反推昨收再算绝对变化',
      '  const prev = chgPct != null && chgPct !== -100 ? price / (1 + chgPct / 100) : null;',
      '  return {',
      '    price,',
      '    chg: prev != null ? price - prev : null,',
      '    chgPct,',
      '    name: j?.description || symbol,',
      '    time: null,',
      "    src: 'tv',",
      '    at: Date.now(),',
      '  };',
      '}',
      '',
    ] },
    { line: 280, expect: '// 4) CNN', renumber: ['4)', '5)'] },
    { line: 274, end: 275, expect: 'const y = l.yahoo ? yahooMap', replace: [
      '    const y = l.yahoo ? yahooMap.get(l.yahoo) : null;',
      '    const t = l.tv ? tvMap.get(l.tv) : null;',
      '    const pick = c && c.chgPct != null ? c : y || t || c || null;',
    ] },
    { line: 271, expect: '// 3)', renumber: ['3)', '4)'], before: [
      '  // 3) TradingView 兜底：只给 CNBC / Yahoo 都拿不到的腿（目前是 DAX、TOPIX 期货）',
      '  const needTv = [];',
      '  const seenTv = new Set();',
      '  for (const l of stale) {',
      '    if (!l.tv || seenTv.has(l.tv)) continue;',
      '    const c0 = l.cnbc ? cnbcMap.get(l.cnbc) : null;',
      '    const y0 = l.yahoo ? yahooMap.get(l.yahoo) : null;',
      '    if ((c0 && c0.chgPct != null) || y0) continue;',
      '    seenTv.add(l.tv);',
      '    needTv.push(l.tv);',
      '  }',
      '  const tvMap = new Map();',
      '  await mapLimit(needTv, TV_CONCURRENCY, async (symbol) => {',
      '    try {',
      '      tvMap.set(symbol, await fetchTradingView(symbol));',
      '    } catch (e) {',
      '      stats.errors++;',
      '      console.warn(`[finance] tv ${symbol} 失败: ${e.message}`);',
      '    }',
      '  });',
      '',
    ] },
  ],
  'src/finance-catalog.js': [
    { line: 498, expect: 'Deutsche Börse', replace: [
      "        srcNote: 'Deutsche Börse / TradingView（期货延迟约 15 分钟）',",
    ] },
    { line: 497, expect: '期货说明', replace: [
      '<b>期货说明：</b>CNBC 和 Yahoo 都不提供 DAX 期货，这里走 TradingView 的公开端点取 Eurex 的 DAX 期货（FDAX）。<b>注意这是约 15 分钟延迟的数据</b>——用来判断隔夜欧洲盘的方向够用，别拿它做交易触发。同交易所还有迷你合约 FDXM（合约价值为 1/5），走势与 FDAX 完全一致。',
      '<b>为什么值得看期货：</b>DAX 现货收盘后，DAX 期货在美股时段仍在交易，是观察 ECB 决议、欧洲财政事件即时定价的窗口，不用等到第二天欧洲开盘。`,',
    ] },
    { line: 487, expect: "cnbc: '.DAX'", replace: [
      '        legs: [',
      "          { label: '现货', cnbc: '.DAX', yahoo: '^GDAXI' },",
      "          { label: '期货', tv: 'EUREX:FDAX1!' },",
      '        ],',
    ] },
    { line: 486, expect: "en: 'DAX 40'", replace: ["        en: 'DAX 40 / DAX Futures',"] },
    { line: 451, expect: 'CNBC · 实时', replace: [
      "        srcNote: 'CNBC · 期货：TradingView（约 15 分钟延迟）',",
    ] },
    { line: 450, expect: '政策底属性', appendBefore: '`,\n' + '' },
    { line: 442, expect: "cnbc: '.TOPX'", replace: [
      '        legs: [',
      "          { label: '现货', cnbc: '.TOPX' },",
      "          { label: '期货', tv: 'OSE:TOPIX1!' },",
      '        ],',
    ] },
    { line: 441, expect: 'Tokyo Stock Price Index', replace: [
      "        en: 'Tokyo Stock Price Index / TOPIX Futures',",
    ] },
  ],
};

const TOPIX_ADD =
  '<b>期货说明：</b>TOPIX 期货取自大阪交易所（OSE），走 TradingView 公开端点，<b>约 15 分钟延迟</b>。日本现货收盘后 TOPIX 期货仍在夜盘交易，可以提前看到次日开盘方向。';

function renumber(line, [from, to]) {
  const i = line.indexOf('// ' + from);
  if (i < 0) throw new Error(`无法改编号: ${line}`);
  return line.slice(0, i) + '// ' + to + line.slice(i + 3 + from.length);
}

for (const [file, list] of Object.entries(ops)) {
  const orig = fs.readFileSync(file, 'utf8');
  const lines = orig.split('\n');

  // 1) 先全部校验锚点
  for (const op of list) {
    const got = lines[op.line - 1];
    if (got === undefined) throw new Error(`${file}:${op.line} 不存在`);
    if (op.expect && !got.includes(op.expect)) {
      throw new Error(`${file}:${op.line} 锚点不符\n  期望含: ${op.expect}\n  实际:   ${got}`);
    }
  }

  // 2) 从底往上应用
  const sorted = [...list].sort((a, b) => (b.end || b.line) - (a.end || a.line));
  for (const op of sorted) {
    const idx = op.line - 1;
    const endIdx = op.end ? op.end - 1 : idx;
    let repl;
    if (op.replace) repl = op.replace;
    else if (op.renumber) repl = [renumber(lines[idx], op.renumber)];
    else if (op.keep === null) repl = [lines[idx]];
    else repl = [lines[idx]];

    const out = [];
    if (op.before) out.push(...op.before);
    out.push(...repl);
    if (op.after) out.push(...op.after);
    if (op.appendBefore) {
      const last = out[out.length - 1];
      const j = last.lastIndexOf('`');
      if (j < 0) throw new Error(`${file}:${op.line} 找不到行尾反引号`);
      out[out.length - 1] = last.slice(0, j) + '\n' + TOPIX_ADD + last.slice(j);
    }
    lines.splice(idx, endIdx - idx + 1, ...out);
  }

  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  console.log(`✅ ${file}  补丁已应用（${list.length} 处）`);
}
