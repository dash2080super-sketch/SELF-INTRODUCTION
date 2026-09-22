const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// 1) spark 批量接口
const syms = ['^NDX', 'NQ=F', '^GSPC', 'ES=F', '^VIX', '^VXN', '^VVIX', '^SKEW', '^MOVE', '^VIX9D'];
const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(syms.join(','))}&range=5d&interval=1d`;
const r = await fetch(url, { headers: { 'User-Agent': UA } });
console.log('spark HTTP', r.status);
const j = await r.json();
for (const [k, v] of Object.entries(j.spark || j)) {
  const c = v?.close;
  console.log(k, 'close tail=', Array.isArray(c) ? c.slice(-3) : c, 'ts=', (v?.timestamp || []).slice(-3));
}

// 2) NQ=F 单标的 chart 明细
const u2 = 'https://query1.finance.yahoo.com/v8/finance/chart/NQ=F?range=5d&interval=1d&includePrePost=false';
const j2 = await (await fetch(u2, { headers: { 'User-Agent': UA } })).json();
const res = j2.chart.result[0];
console.log('\nNQ=F meta:', {
  p: res.meta.regularMarketPrice,
  prev: res.meta.chartPreviousClose,
  prevClose: res.meta.previousClose,
  ts: res.meta.regularMarketTime,
});
console.log('NQ=F ts:', res.timestamp.map((t) => new Date(t * 1000).toISOString().slice(0, 16)));
console.log('NQ=F closes:', res.indicators.quote[0].close);

// 3) CNN
const cnn = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
  headers: { 'User-Agent': UA, Referer: 'https://www.cnn.com/markets/fear-and-greed' },
});
const cj = await cnn.json();
console.log('\nCNN:', cj.fear_and_greed.score, cj.fear_and_greed.rating, cj.fear_and_greed.timestamp);
console.log('CNN prevClose:', cj.fear_and_greed.previous_close, '1d:', cj.fear_and_greed.previous_1_week, '1m:', cj.fear_and_greed.previous_1_month, '1y:', cj.fear_and_greed.previous_1_year);

// 4) NAAIM
const naaim = await fetch('https://naaim.org/programs/naaim-exposure-index/', { headers: { 'User-Agent': UA } });
const html = await naaim.text();
console.log('\nNAAIM HTTP', naaim.status, 'len', html.length);
const m = html.match(/([\d.]+)\s*%/g);
console.log('NAAIM % candidates:', (m || []).slice(0, 12));
const rowIdx = html.indexOf('Mean');
console.log('around Mean:', html.slice(rowIdx - 200, rowIdx + 400).replace(/\s+/g, ' '));
