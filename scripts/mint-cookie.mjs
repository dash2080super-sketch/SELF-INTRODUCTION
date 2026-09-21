// 仅在服务器上用于自测：用 .env 里的 SESSION_SECRET 签一个短期会话 cookie
import fs from 'node:fs';
import crypto from 'node:crypto';

const env = Object.fromEntries(
  fs.readFileSync('/opt/billboard/.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const secret = env.SESSION_SECRET;
if (!secret) {
  console.error('no SESSION_SECRET');
  process.exit(1);
}
const mins = Number(process.argv[2] || 10);
const body = Buffer.from(JSON.stringify({ exp: Date.now() + mins * 60_000 })).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
process.stdout.write(`${body}.${sig}`);
