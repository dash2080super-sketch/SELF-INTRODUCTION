const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// 找 CME 股指期货在 CNBC 上的符号：能批量就意味着便宜
const cands = [
  '@ES.1', '@NQ.1', '@RTY.1', '@VXA.1',
  '@ES1!', '@NQ1!',
  'ES1!', 'NQ1!', 'RTY1!',
  '@ESU26', '@ESZ26', '@NQU26', '@NQZ26',
  '@SPA.1', '@ENQ.1', '@ER2.1',
  '@E-mini.1',
];

const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(cands.join('|'))}&requestMethod=itv&noform=1&partnerId=2&output=json`;
const j = await (await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })).json();
console.log('=== CNBC 候选 ===');
for (const q of [].concat(j?.FormattedQuoteResult?.FormattedQuote || [])) {
  console.log(`${String(q.symbol).padEnd(10)} code=${q.code} last=${q.last} pct=${q.change_pct} ${q.name || ''}`);
}

// 对照：Yahoo 上这几个期货的现实 здоровье
console.log('\n=== Yahoo 期货耗时测试 ===');
for (const s of ['ES=F', 'NQ=F', 'NKD=F', 'JPY=X', 'CL=F']) {
  const t0 = Date.now();
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=2d&interval=1d`, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000),
    });
    const j2 = await r.json();
    const p = j2.chart?.result?.[0]?.meta?.regularMarketPrice;
    console.log(`${s.padEnd(8)} ${r.status} ${p} ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`${s.padEnd(8)} ERR ${e.message} ${Date.now() - t0}ms`);
  }
}
