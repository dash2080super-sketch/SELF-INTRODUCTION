const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const cands = [
  '@DAX.1', '@FDAX.1', '@DAX', '@GDAXI.1', '@CAC.1', '@FCE.1', '@CAC40.1',
  '@FTSE.1', '@FFI.1', '@Z.1', '@FTS.1', '@NKD.1', '@NIY.1', '@N225.1',
  '@TOPX.1', '@VXN.1', '@SPX.1', '@NDX.1', '@RUT.1', '@SOX.1', '@HSI.1', '@KOSPI.1',
];
async function cnbc(batch) {
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(batch.join('|'))}&requestMethod=itv&noform=1&partnerId=2&output=json`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    const j = await r.json();
    const arr = j?.FormattedQuoteResult?.FormattedQuote;
    if (!arr) return;
    const list = Array.isArray(arr) ? arr : [arr];
    for (const q of list) {
      if (String(q.code) !== '0') continue;
      console.log(`${String(q.symbol).padEnd(11)} last=${String(q.last).padEnd(12)} pct=${String(q.change_pct).padEnd(9)} ${q.name || ''}`);
    }
  } catch (e) {
    console.log('ERR', e.message);
  }
}
for (let i = 0; i < cands.length; i += 8) await cnbc(cands.slice(i, i + 8));
console.log('-- done --');
