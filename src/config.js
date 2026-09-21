import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// 极简 .env 解析（不引第三方依赖，省内存/省安装体积）
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  passwordHash: process.env.PASSWORD_HASH || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  dbPath: path.resolve(ROOT, process.env.DB_PATH || 'data/billboard.db'),
  publicDir: path.join(ROOT, 'public'),
  isProd: process.env.NODE_ENV === 'production',
};

export function assertConfig() {
  const missing = [];
  if (!config.passwordHash) missing.push('PASSWORD_HASH');
  if (!config.sessionSecret) missing.push('SESSION_SECRET');
  if (missing.length) {
    console.error(
      `[billboard] 缺少配置: ${missing.join(', ')}\n` +
        `  请先运行:  npm run set-password\n` +
        `  或手动在 ${envPath} 中写入这两项。`
    );
    process.exit(1);
  }
  if (!config.passwordHash.startsWith('$2')) {
    console.error('[billboard] PASSWORD_HASH 不是合法的 bcrypt hash，请重新运行 npm run set-password');
    process.exit(1);
  }
}
