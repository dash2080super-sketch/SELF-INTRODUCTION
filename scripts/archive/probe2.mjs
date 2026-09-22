const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function yahoo(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d&includePrePost=false`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) return `${sym}: HTTP ${r.status}`;
    const j = await r.json();
    const m = j?.chart?.result?.[0]?.meta;
    if (!m) return `${sym}: no meta`;
    return `${sym}: price=${m.regularMarketPrice} prev=${m.chartPreviousClose ?? m.previousClose} cur=${m.currency} name=${m.symbol}`;
  } catch (e) {
    return `${sym}: ERR ${e.message}`;
  }
}

const syms = [
  '^TOPX', '1306.T', '^TPX', 'TPX',           // TOPIX 候选
  'FDAX=F', 'FCE=F', 'FFI=F',                  // 欧股期货
  'FDAX1!', 'FCE1!', 'FFI1!',
  '^GDAXI', '^FCHI', '^FTSE',
  '^TNX', '^TYX', '^FVX', '^IRX',              // 美债
  '^UST10Y', '^JGB10Y',                        // 猜
  'JPY=X', 'DX-Y.NYB',
  '^SOX', '^NDX', 'NQ=F',
  '^VIX9D', '^VIX1D', '^VVIX', '^SKEW', '^MOVE', '^VXN',
  '^RUT', '^KS11', '^HSI', 'NKD=F',
];

for (const s of syms) {
  console.log(await yahoo(s));
}

// stooq 兜底测试
async function stooq(sym) {
  try {
    const r = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`, { headers: { 'User-Agent': UA } });
    const t = await r.text();
    return `stooq ${sym}: ${t.trim().split('\n').slice(0, 3).join(' | ')}`;
  } catch (e) {
    return `stooq ${sym}: ERR ${e.message}`;
  }
}
console.log('--- stooq ---');
for (const s of ['^topx', '^dax', '^cac', '^ftm', '10usy.b', '10jpy.b']) {
  console.log(await stooq(s));
}
