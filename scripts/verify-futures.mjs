// DAX / TOPIX 期货新增功能的端到端验收（在服务器上跑）。
// 用法：node scripts/verify-futures.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';

const ENV_PATH = process.env.ENV_PATH || '/opt/billboard/.env';
const PORT = process.env.PORT || 3000;
const B = `http://127.0.0.1:${PORT}`;

const secret = fs
  .readFileSync(ENV_PATH, 'utf8')
  .match(/^SESSION_SECRET=(.*)$/m)[1]
  .trim()
  .replace(/^["']|["']$/g, '');
const payload = Buffer.from(JSON.stringify({ u: 'verify-futures', exp: Date.now() + 3600_000 })).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
const H = { cookie: `bb_session=${payload}.${sig}` };

const j = await (await fetch(`${B}/api/finance`, { headers: H })).json();
if (!Array.isArray(j.zones)) throw new Error('接口结构异常: ' + JSON.stringify(j).slice(0, 200));

const all = [];
for (const z of j.zones) for (const it of z.items) all.push(it);

let fail = 0;
const need = [
  ['dax', '现货', '期货'],
  ['topix', '现货', '期货'],
];

console.log('=== 新增期货腿 ===');
for (const [id, ...labels] of need) {
  const it = all.find((x) => x.id === id);
  if (!it) {
    console.log(`❌ 找不到指标 ${id}`);
    fail++;
    continue;
  }
  console.log(`${it.name} (${it.id})`);
  for (const lb of labels) {
    const q = it.legs[lb];
    if (!q) {
      console.log(`   ❌ 缺腿「${lb}」 实际有: ${Object.keys(it.legs).join('/') || '无'}`);
      fail++;
      continue;
    }
    const ok = q.price != null && Number.isFinite(q.price);
    if (!ok) fail++;
    const age = q.at ? Math.round((Date.now() - q.at) / 1000) + 's' : '?';
    console.log(
      `   ${ok ? '✅' : '❌'} ${lb.padEnd(3)} ${String(q.price).padEnd(11)} chg=${String(q.chgPct).padEnd(8)} src=${q.src} (${age} 前)`
    );
  }
  console.log(`   源注: ${it.srcNote}`);
}

console.log('\n=== 期货腿源检查（应为 tv） ===');
for (const [id] of need) {
  const it = all.find((x) => x.id === id);
  const q = it?.legs?.['期货'];
  if (!q) { fail++; continue; }
  if (q.src !== 'tv') {
    console.log(`   ⚠ ${id} 期货腿来自 ${q.src}（预期 tv）`);
  } else {
    console.log(`   ✅ ${id} 期货腿来自 TradingView`);
  }
}

console.log('\n=== 回归：全盘腿空缺检查 ===');
const empty = all.filter((i) => !i.manual && Object.keys(i.legs).length === 0);
const nullLegs = [];
for (const i of all) {
  for (const [lb, q] of Object.entries(i.legs)) if (q.price == null) nullLegs.push(`${i.id}/${lb}`);
}
console.log(`   指标总数 ${all.length}，整块无数据 ${empty.length} 个：${empty.map((x) => x.id).join(',') || '无'}`);
console.log(`   单腿无价 ${nullLegs.length} 个：${nullLegs.join(',') || '无'}`);
if (empty.length) fail++;

console.log('\n=== 前端资源（确认新版 finance.js 已上线） ===');
try {
  const SITE = process.env.SITE || 'https://vic-jianhua.me';
  const idx = await fetch(`${SITE}/index.html`, { headers: H });
  const html = await idx.text();
  const v = (html.match(/\?v=([a-f0-9]{6,})/) || [])[1];
  console.log(`   index.html ${idx.status}，资源版本 ${v || '(未识别)'}`);
  const fe = await fetch(`${SITE}/js/modules/finance.js`, { headers: H });
  const feTxt = await fe.text();
  const has = feTxt.includes('TradingView');
  console.log(`   ${has ? '✅' : '❌'} finance.js 含 TradingView 数据源说明（${feTxt.length} 字节）`);
  if (!has) fail++;
} catch (e) {
  console.log('   ⚠ 公网检查失败: ' + e.message);
  fail++;
}

console.log(`\nstats: ${JSON.stringify(await (await fetch(`${B}/api/finance/stats`, { headers: H })).json())}`);
console.log(fail ? `\n❌ 验收失败：${fail} 处问题` : '\n✅ 验收通过');
process.exit(fail ? 1 : 0);
