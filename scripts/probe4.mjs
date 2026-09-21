const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function get(url, ms = 8000) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(ms) });
    return { status: r.status, t: await r.text() };
  } catch (e) {
    return { status: 'ERR', t: e.name + ' ' + e.message };
  }
}

for (const s of ['^NYAD', '^NYMO', '^NYSE', '^XAX', '^RUI', '^RUA']) {
  const { status, t } = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1mo&interval=1d`);
  let price = 'n/a';
  let n = 0;
  try {
    const j = JSON.parse(t).chart.result[0];
    price = j.meta?.regularMarketPrice;
    n = j.timestamp?.length;
  } catch {}
  console.log(`Yahoo ${s}: ${status} price=${price} pts=${n}`);
}

const { status, t } = await get('https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=JP10Y&requestMethod=itv&noform=1&partnerId=2&output=json', 8000);
console.log('CNBC JP10Y:', status, t.slice(0, 300).replace(/\s+/g, ' '));
