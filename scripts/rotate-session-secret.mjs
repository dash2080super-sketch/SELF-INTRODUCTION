#!/usr/bin/env node
/* 轮换 SESSION_SECRET —— 把所有已登录会话一次性踢下线。
 *
 * 什么时候用：
 *   密码泄露 / 改完密码 / 怀疑有人拿着旧 cookie。
 *   set-password.js 为了"不把已登录设备踢下线"会**沿用**旧的 SESSION_SECRET，
 *   这在正常改密码时是体贴，但在泄露场景里是漏洞：旧 cookie 还能用 30 天
 *   （SESSION_DAYS）。所以泄露后必须再跑本脚本把密钥换掉。
 *
 * 用法（在服务器上）：
 *   cd /opt/billboard && node scripts/rotate-session-secret.mjs
 *   systemctl restart billboard
 *
 * 只改 .env 里的 SESSION_SECRET 一行，其它配置不动。改完必须重启才生效。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = process.env.ENV_PATH || path.join(ROOT, '.env');

if (!fs.existsSync(ENV_PATH)) {
  console.error(`找不到 ${ENV_PATH}`);
  process.exit(1);
}

const before = fs.readFileSync(ENV_PATH, 'utf8');
const re = /^SESSION_SECRET=.*$/m;
if (!re.test(before)) {
  console.error('.env 里没有 SESSION_SECRET，先跑 scripts/set-password.js');
  process.exit(1);
}

const next = crypto.randomBytes(32).toString('base64url');
const after = before.replace(re, `SESSION_SECRET=${next}`);
fs.writeFileSync(ENV_PATH, after, { mode: 0o600 });

console.log('✅ SESSION_SECRET 已轮换，所有旧会话作废。');
console.log('   下一步： systemctl restart billboard');
console.log('   （所有人需要重新登录一次，这是故意的）');
