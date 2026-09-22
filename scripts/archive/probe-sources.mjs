#!/usr/bin/env node
/* 数据源探测：批量试 Yahoo / CBOE / CNN，看哪些标的取得到。
   用法: node scripts/probe-sources.mjs            # 用内置清单
        node scripts/probe-sources.mjs ^VIX NVDA   # 试指定代码
   只打印「代码 | 价格 | 名称」，取不到的显示 N/A。 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

const DEFAULT = [
  // 美股指数与期货
  '^NDX', 'NQ=F', '^GSPC', 'ES=F',
  // 美债收益率
  '^IRX', '^FVX', '^TNX', '^TYX',
  // 商品
  'GC=F', 'CL=F',
  // 亚太
  '^N225', '^TOPX', '^KS11', '^HSI',
  // 欧洲
  '^GDAXI', '^FCHI', '^FTSE',
  // 汇率
  'USDCNY=X', 'USDJPY=X', 'CNYJPY=X',
  // 个股与行业
  'NVDA', '^SOX',
  // 波动率与情绪
  '^VIX', '^VXN', '^VVIX', '^SKEW', '^MOVE', '^RUT', '^VIX9D', '^VIX1D',
  // 期货候选（不一定存在）
  'NKD=F', 'FDAX=F', 'FCE=F', 'FFI=F', 'Z=F', 'JN=F', 'YAP=F',
];

const symbols = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;

async function yahoo(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return { price: `HTTP${r.status}`, name: '' };
  const j = await r.json();
  const meta = j?.chart?.result?.[0]?.meta;
  if (!meta) return { price: 'N/A', name: '' };
  return {
    price: meta.regularMarketPrice,
    change: meta.regularMarketChangePercent,
    name: meta.shortName || meta.symbol || '',
    time: meta.regularMarketTime,
  };
}

console.log('代码'.padEnd(12), '| 价格'.padEnd(12), '| 涨跌%'.padEnd(8), '| 名称');
console.log('-'.repeat(70));
for (const s of symbols) {
  try {
    const r = await yahoo(s);
    const ch = r.change != null ? Number(r.change).toFixed(2) : '-';
    console.log(String(s).padEnd(12), '|', String(r.price).padEnd(12), '|', String(ch).padEnd(8), '|', r.name);
  } catch (e) {
    console.log(String(s).padEnd(12), '| ERR'.padEnd(12), '| -'.padEnd(8), '|', e.message.slice(0, 40));
  }
  await new Promise((r) => setTimeout(r, 150));
}
