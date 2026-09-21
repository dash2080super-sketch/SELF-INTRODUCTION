// 免密自检：用 .env 里的 SESSION_SECRET 自己签一个会话 cookie，
// 打一次 /api/finance + /api/finance/stats，打印健康摘要。
// 用法：node scripts/check-live.mjs   （默认 3000 端口，可用 PORT 覆盖）
import fs from 'node:fs';
import crypto from 'node:crypto';

const ENV_PATH = process.env.ENV_PATH || '/opt/billboard/.env';
const PORT = process.env.PORT || 3000;

const envTxt = fs.readFileSync(ENV_PATH, 'utf8');
const m = envTxt.match(/^SESSION_SECRET=(.*)$/m);
if (!m) { console.error('找不到 SESSION_SECRET：' + ENV_PATH); process.exit(1); }
const secret = m[1].trim().replace(/^["']|["']$/g, '');

const payload = Buffer.from(JSON.stringify({ u: 'selfcheck', exp: Date.now() + 3600_000 })).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
const cookie = `${payload}.${sig}`;

const get = (p) => fetch(`http://127.0.0.1:${PORT}${p}`, { headers: { cookie: `bb_session=${cookie}` } })
  .then(async (r) => { if (!r.ok) throw new Error(p + ' -> HTTP ' + r.status); return r.json(); });

const d = await get('/api/finance');
const now = Date.now();

let items = 0, emptyLegs = 0, staleFast = 0, fastest = Infinity, slowest = 0;
const tierCount = {};
const rows = [];

for (const z of d.zones || []) {
  for (const it of z.items || []) {
    items++;
    tierCount[it.tier] = (tierCount[it.tier] || 0) + 1;
    const legs = Object.entries(it.legs || {});
    if (!legs.length) emptyLegs++;
    let age = Infinity;
    for (const [, q] of legs) {
      if (!q || q.price == null) { emptyLegs++; continue; }
      if (q.at) age = Math.min(age, Math.round((now - q.at) / 1000));
    }
    if (Number.isFinite(age)) {
      fastest = Math.min(fastest, age);
      slowest = Math.max(slowest, age);
      if (it.tier === 'fast' && age > 60) staleFast++;
    }
    rows.push(`${it.id}[${it.tier}]${Number.isFinite(age) ? age + 's' : '-'}`);
  }
}

console.log(`分区 ${d.zones?.length} / 指标 ${items} / 分层 ${JSON.stringify(tierCount)}`);
console.log(`空腿 ${emptyLegs} / 快线超时(>60s) ${staleFast} / 最新 ${fastest}s / 最旧 ${slowest}s`);
console.log('明细：' + rows.join(' '));
console.log('meta：' + JSON.stringify(d.meta));
console.log('资源：' + JSON.stringify(await get('/api/finance/stats')));
