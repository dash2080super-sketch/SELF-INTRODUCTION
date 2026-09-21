#!/usr/bin/env node
/* 备份 SQLite（用官方 backup API，可在服务运行中安全拷贝，不会拿到半个文件）。
   用法: node scripts/backup-db.mjs
   环境变量: DB_PATH(源库) BACKUP_DIR(备份目录) KEEP_DAYS(保留天数, 默认 14) */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SRC = process.env.DB_PATH || '/opt/billboard/data/billboard.db';
const DIR = process.env.BACKUP_DIR || '/opt/backup';
const KEEP = Number(process.env.KEEP_DAYS || 14);

if (!fs.existsSync(SRC)) {
  console.error(`源库不存在: ${SRC}`);
  process.exit(1);
}

fs.mkdirSync(DIR, { recursive: true });

// 按本地日期命名（服务器时区为 UTC，想按北京时间可设 TZ=Asia/Shanghai）
const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dest = path.join(DIR, `billboard-${stamp}.db`);

const db = new Database(SRC);
await db.backup(dest);
db.close();

const size = (fs.statSync(dest).size / 1024).toFixed(1);
console.log(`${new Date().toISOString()} 备份完成: ${dest} (${size} KB)`);

const cutoff = Date.now() - KEEP * 86400000;
let removed = 0;
for (const f of fs.readdirSync(DIR)) {
  if (!/^billboard-\d{4}-\d{2}-\d{2}\.db$/.test(f)) continue;
  const p = path.join(DIR, f);
  if (fs.statSync(p).mtimeMs < cutoff) {
    fs.unlinkSync(p);
    removed++;
  }
}
console.log(`保留 ${KEEP} 天，清理旧备份 ${removed} 个`);
