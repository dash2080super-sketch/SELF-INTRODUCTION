// 探测 DAX / TOPIX / 欧洲股指期货在公开免费源上的可用符号。
// 必须在 VPS 上跑（本机连不上 CNBC / Yahoo）。
// 用法：node scripts/probe-eu-futures.mjs
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const cnbcCands = [
  // DAX 期货（Eurex：FDAX 标准 / FDXS 迷你）
  '@FDAX.1', '@FDAX.2', '@FDXM.1', '@FDX.1', '@FDX.2', '@DAX.1', '@DAX.2', '@FDXS.1', '@FDXS.2',
  // Euro Stoxx 50 期货（做对照，流动性最好）
  '@FESX.1', '@FESX.2', '@STX.1', '@FESB.1',
  // TOPIX / 日经期货
  '@TOPX.1', '@TPX.1', '@TOPIX.1', '@JTI.1', '@NKD.1', '@NIY.1', '@NIZ.1', '@SSI.1',
  // 已确认可用的对照项
  '@FCE.1', '@FFI.1',
];
const yahooCands = [
  // DAX
  'FDX=F', 'FDAX=F', 'FDXM=F', 'FDXS=F', '^GDAXI',
  // TOPIX / 日经
  'TOPIX=F', 'TPX=F', '^TOPX', 'NKD=F',
  // 对照
  '^FCHI', '^FTSE',
];

console.log('=== CNBC 批量探测 ===');
try {
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(
    cnbcCands.join('|')
  )}&requestMethod=itv&noform=1&partnerId=2&output=json`;
  const j = await (await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })).json();
  const rows = [].concat(j?.FormattedQuoteResult?.FormattedQuote || []);
  const got = new Set();
  for (const q of rows) {
    got.add(String(q.symbol));
    console.log(
      `${String(q.symbol).padEnd(11)} code=${String(q.code).padEnd(8)} last=${String(q.last).padEnd(11)} pct=${String(
        q.change_pct
      ).padEnd(8)} ${q.name || ''}`
    );
  }
  const missing = cnbcCands.filter((c) => !got.has(c));
  console.log(`\n无返回(${missing.length}): ${missing.join(' ')}`);
} catch (e) {
  console.log('CNBC 失败: ' + e.message);
}

console.log('\n=== Yahoo 单查探测 ===');
for (const s of yahooCands) {
  const t0 = Date.now();
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=5d&interval=1d`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) }
    );
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const closes = (res?.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const pct = last != null && prev != null ? (((last - prev) / prev) * 100).toFixed(2) + '%' : '—';
    console.log(
      `${s.padEnd(10)} ${r.status} price=${last ?? '—'} chg=${pct} cur=${res?.meta?.currency || '—'} ${
        res?.meta?.shortName || ''
      } ${Date.now() - t0}ms`
    );
  } catch (e) {
    console.log(`${s.padEnd(10)} ERR ${e.message} ${Date.now() - t0}ms`);
  }
}
