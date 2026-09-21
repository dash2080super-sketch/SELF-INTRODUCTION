// 「风险偏好」分区 + 台湾加权的端到端验收（在服务器上跑）。
// 关键点：比值不能只信自己算的 —— 这里独立去 Yahoo 拉两个 ETF，反算一遍对账。
// 用法：node scripts/verify-appetite.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';

const ENV_PATH = process.env.ENV_PATH || '/opt/billboard/.env';
const PORT = process.env.PORT || 3000;
const B = `http://127.0.0.1:${PORT}`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const secret = fs
  .readFileSync(ENV_PATH, 'utf8')
  .match(/^SESSION_SECRET=(.*)$/m)[1]
  .trim()
  .replace(/^["']|["']$/g, '');
const payload = Buffer.from(JSON.stringify({ u: 'verify-appetite', exp: Date.now() + 3600_000 })).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
const H = { cookie: `bb_session=${payload}.${sig}` };

let fail = 0;
const bad = (m) => {
  console.log('   ❌ ' + m);
  fail++;
};

const j = await (await fetch(`${B}/api/finance`, { headers: H })).json();
if (!Array.isArray(j.zones)) throw new Error('接口结构异常');
const all = [];
for (const z of j.zones) for (const it of z.items) all.push({ ...it, _zone: z.id });

console.log('=== 分区表 ===');
for (const z of j.zones) console.log(`  ${z.name}（${z.items.length} 项）`);
console.log(`  合计 ${all.length} 项`);

console.log('\n=== 新分区「风险偏好」 ===');
const ap = j.zones.find((z) => z.id === 'appetite');
if (!ap) bad('没有 appetite 分区');
else {
  const ids = ap.items.map((x) => x.id);
  console.log(`  ${ap.name} / icon=${ap.icon} / 成员: ${ids.join(', ')}`);
  for (const want of ['credit', 'breadth', 'btc']) if (!ids.includes(want)) bad(`缺 ${want}`);
}

console.log('\n=== 比值对账（独立去 Yahoo 反算） ===');
async function yprice(sym) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  const jj = await r.json();
  const closes = (jj.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
  return closes.at(-1);
}
for (const [id, num, den, scale] of [
  ['credit', 'HYG', 'IEF', 100],
  ['breadth', 'RSP', 'SPY', 100],
]) {
  const it = all.find((x) => x.id === id);
  if (!it) { bad(`缺 ${id}`); continue; }
  const [pn, pd] = await Promise.all([yprice(num), yprice(den)]);
  const expect = (pn / pd) * scale;
  const got = Object.values(it.legs)[0]?.price;
  const src = Object.values(it.legs)[0]?.src;
  const label = Object.keys(it.legs)[0];
  const diff = got != null ? Math.abs(got - expect) / expect : 1;
  const ok = got != null && diff < 0.005 && src === 'derived';
  console.log(
    `  ${ok ? '✅' : '❌'} ${it.name.padEnd(6)} 展示腿「${label}」= ${got}  src=${src}  独立反算 ${num}/${den}×${scale} = ${expect.toFixed(4)} 偏差 ${(diff * 100).toFixed(3)}%`
  );
  if (!ok) fail++;
}

console.log('\n=== 另外两个新指标 ===');
for (const [id, wantZone] of [['twii', 'global'], ['btc', 'appetite']]) {
  const it = all.find((x) => x.id === id);
  if (!it) { bad(`缺 ${id}`); continue; }
  const zoneOk = it._zone === wantZone;
  console.log(`  ${zoneOk ? '✅' : '❌'} ${it.name} 在分区 ${it._zone}（期望 ${wantZone}）`);
  if (!zoneOk) fail++;
  for (const [lb, q] of Object.entries(it.legs)) {
    const ok = q.price != null && Number.isFinite(q.price);
    console.log(`      ${ok ? '✅' : '❌'} ${lb.padEnd(9)} ${String(q.price).padEnd(11)} chg=${q.chgPct} src=${q.src}`);
    if (!ok) fail++;
  }
  console.log(`      源注: ${it.srcNote}`);
}

console.log('\n=== 回归：全盘腿空缺 ===');
const empty = all.filter((i) => !i.manual && Object.keys(i.legs).length === 0);
const nullLegs = [];
for (const i of all) for (const [lb, q] of Object.entries(i.legs)) if (q.price == null) nullLegs.push(`${i.id}/${lb}`);
console.log(`  指标 ${all.length} 项，整块无数据 ${empty.length} 个：${empty.map((x) => x.id).join(',') || '无'}`);
console.log(`  单腿无价 ${nullLegs.length} 个：${nullLegs.join(',') || '无'}`);
if (empty.length || nullLegs.length) fail++;

console.log(`\nstats: ${JSON.stringify(await (await fetch(`${B}/api/finance/stats`, { headers: H })).json())}`);
console.log(fail ? `\n❌ 验收失败：${fail} 处问题` : '\n✅ 验收通过');
process.exit(fail ? 1 : 0);
