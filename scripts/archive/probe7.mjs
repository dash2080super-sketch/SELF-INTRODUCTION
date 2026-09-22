const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const cands = ['@DAX.1', '@DAXF.1', '@DE30.1', '@GX.1', '@FDAX', 'DAX.1', '@DA.1', '@DX.1', '@FDAX.2', '@EXS1.1'];
const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(cands.join('|'))}&requestMethod=itv&noform=1&partnerId=2&output=json`;
const j = await (await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })).json();
for (const q of [].concat(j?.FormattedQuoteResult?.FormattedQuote || [])) {
  console.log(`${String(q.symbol).padEnd(10)} code=${q.code} last=${q.last} ${q.name || ''}`);
}
console.log('--- yahoo guesses ---');
for (const s of ['DAX=F', 'FDAX.DEX', 'GDAXI.DE', '^DAX', 'DAX1!', 'FDAX1!']) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=2d&interval=1d`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) });
    let p = 'n/a';
    if (r.ok) { const j2 = await r.json(); p = j2.chart?.result?.[0]?.meta?.regularMarketPrice; }
    console.log(`${s}: ${r.status} ${p}`);
  } catch (e) { console.log(`${s}: ERR`); }
}
