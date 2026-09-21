// 第三轮：新浪 znb_ 命名空间全景 + OnVista 期货标的 + TradingView scanner 稳定性/元数据
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

await head('新浪 znb_ 命名空间（看有没有期货/指数家族）', async () => {
  const cands = [
    'znb_DAX', 'znb_HSI', 'znb_N225', 'znb_UKX', 'znb_CAC', 'znb_SPX', 'znb_TOPIX', 'znb_FDAX', 'znb_FDX',
    'znb_DAX30', 'znb_NKD', 'znb_ES',
  ];
  for (const s of cands) {
    try {
      const r = await fetch(`https://hq.sinajs.cn/list=${encodeURIComponent(s)}`, {
        headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn' },
        signal: T(10000),
      });
      const txt = (await r.text()).trim();
      const body = txt.replace(/^var\s+\S+="?/, '').replace(/"?;?$/, '');
      console.log(`  ${s.padEnd(11)} ${body ? body.slice(0, 130) : '(空)'}`);
    } catch (e) {
      console.log(`  ${s.padEnd(11)} ERR ${e.message}`);
    }
  }
});

await head('OnVista 搜索：找 DAX / TOPIX 期货标的', async () => {
  for (const q of ['DAX Future', 'Mini-DAX', 'FDAX', 'TOPIX', 'DAX-Future']) {
    try {
      const r = await fetch(`https://api.onvista.de/api/v1/instruments/search?query=${encodeURIComponent(q)}&limit=10`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: T(12000),
      });
      const j = await r.json();
      const list = j?.list || [];
      console.log(`  [${q}] ${list.length} 条`);
      for (const it of list.slice(0, 6)) {
        console.log(`      ${String(it.entityType).padEnd(10)} ${String(it.entityValue).padEnd(9)} ${String(it.symbol || '').padEnd(12)} ${it.displayType || ''} | ${it.name || ''}`);
      }
    } catch (e) {
      console.log(`  [${q}] ERR ${e.message}`);
    }
  }
});

await head('TradingView scanner：元数据 + 连续 3 次测稳定性', async () => {
  const syms = ['EUREX:FDXM1!', 'EUREX:FDAX1!', 'OSE:TOPIXM1!', 'OSE:TOPIX1!'];
  for (const sym of syms) {
    const res = [];
    for (let k = 0; k < 3; k++) {
      const t0 = Date.now();
      try {
        const r = await fetch(
          `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(sym)}&fields=close,change,currency,description,type,exchange,update_mode&no_404=true`,
          { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: T(12000) }
        );
        const j = await r.json();
        if (k === 0) console.log(`  ${sym}\n      ${JSON.stringify(j)}`);
        res.push(`${r.status}/${Math.round(j.close)}/${Date.now() - t0}ms`);
      } catch (e) {
        res.push('ERR/' + e.message);
      }
      await new Promise((s) => setTimeout(s, 400));
    }
    console.log(`      3次: ${res.join('  ')}`);
  }
});
