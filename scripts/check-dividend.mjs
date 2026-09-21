/**
 * 高股息板块接口自检：免密签 cookie → 打 /api/dividend + /stats，打印摘要。
 * 用法：node scripts/check-dividend.mjs
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const ENV_PATH = process.env.ENV_PATH || '/opt/billboard/.env';
const PORT = process.env.PORT || 3000;

const secret = fs
  .readFileSync(ENV_PATH, 'utf8')
  .match(/^SESSION_SECRET=(.*)$/m)[1]
  .trim()
  .replace(/^["']|["']$/g, '');
const payload = Buffer.from(JSON.stringify({ u: 'selfcheck', exp: Date.now() + 3600_000 })).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
const cookie = `${payload}.${sig}`;

const get = (p) =>
  fetch(`http://127.0.0.1:${PORT}${p}`, { headers: { cookie: `bb_session=${cookie}` } }).then(async (r) => {
    if (!r.ok) throw new Error(`${p} -> HTTP ${r.status}`);
    return r.json();
  });

const d = await get('/api/dividend');
console.log(`国债锚: ${d.anchor ? d.anchor.y10 + '% @ ' + d.anchor.date : '❌ 取不到'}`);
console.log(`门槛(${d.strategy.anchorMultiple}× 锚): ${d.anchor ? (d.anchor.y10 * d.strategy.anchorMultiple).toFixed(3) + '%' : '—'}`);
console.log(`关注 ${d.items.length} 只 | 信号分布 ${JSON.stringify(d.counts)}`);
console.log('');

for (const it of d.items) {
  const sig = it.signal?.label || '—';
  console.log(
    `${(it.name || it.code).padEnd(8)} ${it.code}  ¥${String(it.price).padEnd(7)}` +
      ` 股息率 ${String(it.yieldNow).padEnd(6)} 买点 ¥${String(it.target3).padEnd(8)}` +
      ` 距买点 ${String(it.gapToTargetPct).padEnd(7)} → ${sig}`
  );
  if (it.missing?.length) console.log(`    ⚠ 缺失: ${it.missing.join(' / ')}`);
  if (it.error) console.log(`    ❌ ${it.error}`);
}

console.log('');
console.log('meta: ' + JSON.stringify(d.meta));
console.log('stats: ' + JSON.stringify(await get('/api/dividend/stats')));
