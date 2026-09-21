// 探测「下一步可加的候选指标」在哪些源上拿得到。必须在 VPS 上跑。
// 用法：node scripts/probe-candidates.mjs
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const T = (ms) => AbortSignal.timeout(ms);

async function cnbc(label, cands) {
  console.log(`\n=== CNBC · ${label} ===`);
  try {
    const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(
      cands.join('|')
    )}&requestMethod=itv&noform=1&partnerId=2&output=json`;
    const j = await (await fetch(url, { headers: { 'User-Agent': UA }, signal: T(20000) })).json();
    const got = new Set();
    for (const q of [].concat(j?.FormattedQuoteResult?.FormattedQuote || [])) {
      got.add(String(q.symbol));
      const ok = String(q.code) === '0' && q.last != null;
      console.log(
        `  ${ok ? '✅' : '❌'} ${String(q.symbol).padEnd(9)} code=${String(q.code).padEnd(3)} last=${String(q.last).padEnd(11)} pct=${String(q.change_pct).padEnd(8)} ${q.name || ''}`
      );
    }
    const miss = cands.filter((c) => !got.has(c));
    if (miss.length) console.log(`  （无返回: ${miss.join(' ')}）`);
  } catch (e) {
    console.log('  ✗ ' + e.message);
  }
}

async function yahoo(label, cands) {
  console.log(`\n=== Yahoo · ${label} ===`);
  for (const s of cands) {
    try {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=5d&interval=1d`,
        { headers: { 'User-Agent': UA }, signal: T(12000) }
      );
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      if (!res) {
        console.log(`  ❌ ${s.padEnd(11)} ${r.status}`);
        continue;
      }
      const closes = (res.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
      const last = closes.at(-1);
      const prev = closes.at(-2);
      const pct = last != null && prev != null ? (((last - prev) / prev) * 100).toFixed(2) + '%' : '—';
      console.log(
        `  ✅ ${s.padEnd(11)} ${last ?? '—'} chg=${pct.padEnd(7)} ${res.meta?.currency || ''} ${res.meta?.shortName || ''}`
      );
    } catch (e) {
      console.log(`  ❌ ${s.padEnd(11)} ERR ${e.message}`);
    }
  }
}

async function tx(label, cands) {
  console.log(`\n=== 腾讯 · ${label} ===`);
  for (const s of cands) {
    try {
      const r = await fetch(`https://qt.gtimg.cn/q=${encodeURIComponent(s)}`, {
        headers: { 'User-Agent': UA },
        signal: T(10000),
      });
      const txt = new TextDecoder('gbk').decode(Buffer.from(await r.arrayBuffer())).trim();
      const body = txt.replace(/^v_\S+="?/, '').replace(/"?;?$/, '');
      const f = body.split('~');
      const ok = f.length > 5 && f[3];
      console.log(`  ${ok ? '✅' : '❌'} ${s.padEnd(11)} ${ok ? `${f[1]} ${f[3]} ${f[32] || ''}%` : body.slice(0, 60)}`);
    } catch (e) {
      console.log(`  ❌ ${s.padEnd(11)} ERR ${e.message}`);
    }
  }
}

async function sina(label, cands) {
  console.log(`\n=== 新浪 · ${label} ===`);
  for (const s of cands) {
    try {
      const r = await fetch(`https://hq.sinajs.cn/list=${encodeURIComponent(s)}`, {
        headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn' },
        signal: T(10000),
      });
      const txt = (await r.text()).trim();
      const body = txt.replace(/^var\s+\S+="?/, '').replace(/"?;?$/, '');
      console.log(`  ${body ? '✅' : '❌'} ${s.padEnd(13)} ${body ? body.slice(0, 100) : '(空)'}`);
    } catch (e) {
      console.log(`  ❌ ${s.padEnd(13)} ERR ${e.message}`);
    }
  }
}

await cnbc('债券 / 商品 / 其他（含对照项 US3M、@CL.1）', [
  'US3M', 'US2Y', '@CL.1', '@HG.1', '@NG.1', '@SI.1', '@PL.1', '@BTC.1', '.TWII', '.AXJO', '.NSEI', '.KSE',
]);
await yahoo('信用债 ETF / 广度 / 商品 / 中国资产', [
  'HG=F', 'NG=F', 'SI=F', 'BTC-USD', 'HYG', 'LQD', 'IEF', 'TLT', 'RSP', 'SPY', 'KWEB', 'FXI', 'ASHR', '^TWII',
]);
await tx('A股与港股指数', ['sh000001', 'sh000300', 'sh000922', 'sz399006', 'hkHSI', 'hkHSTECH', 'hkHSCEI']);
await sina('现货指数与 AH 溢价候选', ['znb_SHCOMP', 'znb_HSAHP', 'znb_TWII', 'znb_HSI', 'znb_CAC']);
