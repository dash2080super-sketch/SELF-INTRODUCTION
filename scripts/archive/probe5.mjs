const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const cands = [
  // 美债 / 日债 / 欧债
  'US3M', 'US2Y', 'US5Y', 'US10Y', 'US30Y',
  'JP2Y', 'JP5Y', 'JP10Y', 'JP30Y',
  'DE10Y', 'GB10Y',
  // 指数
  '.SPX', '.NDX', '.DJI', '.VIX', '.RUT', '.SOX',
  // 期货
  '@ES.1', '@NQ.1', '@RTY.1', '@VX.1', '@CL.1', '@GC.1',
  // 全球
  '.N225', '.TOPX', '.KS11', '.HSI', '.DAX', '.CAC', '.FTSE', '.STOXX50',
  // 外汇
  'JPY=', 'CNY=', 'USD.JPY', 'USDJPY=', 'USDCNY=', '.DXY',
  // 商品
  '@LCO.1', 'XAU=', 'XAG=',
];

async function cnbc(batch) {
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(batch.join('|'))}&requestMethod=itv&noform=1&partnerId=2&output=json`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    const j = await r.json();
    const arr = j?.FormattedQuoteResult?.FormattedQuote;
    if (!arr) return console.log('batch:', batch.join(','), '-> no result');
    const list = Array.isArray(arr) ? arr : [arr];
    for (const q of list) {
      console.log(
        `${String(q.symbol).padEnd(10)} code=${String(q.code).padEnd(3)} last=${String(q.last).padEnd(12)} chg=${String(q.change).padEnd(8)} pct=${String(q.change_pct).padEnd(8)} ${q.name || ''}`
      );
    }
  } catch (e) {
    console.log('batch ERR', e.name, e.message);
  }
}

for (let i = 0; i < cands.length; i += 8) {
  await cnbc(cands.slice(i, i + 8));
}
