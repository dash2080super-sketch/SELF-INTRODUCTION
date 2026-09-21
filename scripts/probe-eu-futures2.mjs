// 第二轮探测：DAX / TOPIX 期货的其它免费源。
// 必须在 VPS 上跑。用法：node scripts/probe-eu-futures2.mjs
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const T = (ms) => AbortSignal.timeout(ms);

async function head(label, fn) {
  console.log(`\n=== ${label} ===`);
  try {
    await fn();
  } catch (e) {
    console.log('  ✗ ' + e.message);
  }
}

await head('stooq（CSV 报价，先拿对照项验证接口本身可用）', async () => {
  const cands = ['^dax', '^gdaxi', 'fdax.f', 'fdx.f', 'dax.f', 'fda.f', 'es.f', '^spx', 'fce.f', 'ffi.f', 'nkd.f', 'tpx.f', '^nkx'];
  for (const s of cands) {
    try {
      const r = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(s)}&f=sd2t2ohlcv&h&e=csv`, {
        headers: { 'User-Agent': UA },
        signal: T(10000),
      });
      const txt = (await r.text()).trim();
      const nl = txt.indexOf('\n');
      const data = nl >= 0 ? txt.slice(nl + 1).trim() : '';
      console.log(`  ${s.padEnd(10)} ${r.status} ${data || '(空)'}`);
    } catch (e) {
      console.log(`  ${s.padEnd(10)} ERR ${e.message}`);
    }
  }
});

await head('新浪 外盘期货 / 全球指数（hq.sinajs.cn，需 Referer）', async () => {
  const cands = ['hf_DAX', 'hf_FDAX', 'hf_DX', 'hf_GC', 'hf_TOPIX', 'hf_NIY', 'gb_$dax', 'znb_DAX'];
  for (const s of cands) {
    try {
      const r = await fetch(`https://hq.sinajs.cn/list=${encodeURIComponent(s)}`, {
        headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn' },
        signal: T(10000),
      });
      const txt = (await r.text()).trim();
      console.log(`  ${s.padEnd(10)} ${r.status} ${txt.slice(0, 160)}`);
    } catch (e) {
      console.log(`  ${s.padEnd(10)} ERR ${e.message}`);
    }
  }
});

await head('腾讯（qt.gtimg.cn，对照 hf_GC 验证接口）', async () => {
  const cands = ['hf_GC', 'hf_DAX', 'hf_FDAX', 'hf_TOPIX', 'hf_NIY', 'ind_DX', 'ind_DAX', 's_ind_dax'];
  for (const s of cands) {
    try {
      const r = await fetch(`https://qt.gtimg.cn/q=${encodeURIComponent(s)}`, {
        headers: { 'User-Agent': UA },
        signal: T(10000),
      });
      const buf = Buffer.from(await r.arrayBuffer());
      let txt;
      try {
        txt = new TextDecoder('gbk').decode(buf);
      } catch {
        txt = buf.toString('utf8');
      }
      console.log(`  ${s.padEnd(10)} ${r.status} ${txt.trim().slice(0, 160)}`);
    } catch (e) {
      console.log(`  ${s.padEnd(10)} ERR ${e.message}`);
    }
  }
});

await head('OnVista 搜索接口（覆盖 Eurex 期货）', async () => {
  for (const q of ['DAX Future', 'FDXM', 'TOPIX Future']) {
    try {
      const r = await fetch(`https://api.onvista.de/api/v1/instruments/search?query=${encodeURIComponent(q)}&limit=6`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: T(12000),
      });
      const txt = await r.text();
      console.log(`  [${q}] ${r.status} ${txt.slice(0, 400)}`);
    } catch (e) {
      console.log(`  [${q}] ERR ${e.message}`);
    }
  }
});

await head('TradingView scanner（公开只读端点，先看是否可达）', async () => {
  for (const sym of ['EUREX:FDXM1!', 'EUREX:FDAX1!', 'OSE:TOPIXM1!', 'OSE:TOPIX1!']) {
    try {
      const r = await fetch(
        `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(sym)}&fields=close,change,volume&no_404=true`,
        { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: T(12000) }
      );
      const txt = await r.text();
      console.log(`  ${sym.padEnd(16)} ${r.status} ${txt.slice(0, 220)}`);
    } catch (e) {
      console.log(`  ${sym.padEnd(16)} ERR ${e.message}`);
    }
  }
});
