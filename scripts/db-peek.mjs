/* 只读：快速看一眼 kv 与 dividend_watchlist 的实际内容，用于改动后做人工核对。
 * 用法：node scripts/db-peek.mjs
 * 注意：kv 里可能存有敏感值，输出做了截断；不要把完整输出贴到聊天记录里。
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB || path.join(here, '..', 'data', 'billboard.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const clip = (v) => {
  const s = v == null ? '(null)' : String(v);
  return s.length > 60 ? s.slice(0, 60) + `…(${s.length}字)` : s;
};

console.log('== kv ==');
for (const r of db.prepare('select * from kv order by key').all()) {
  const { key, value, ...rest } = r;
  console.log(`  ${key} = ${clip(value)}  ${Object.keys(rest).length ? JSON.stringify(rest) : ''}`);
}

console.log('\n== tables ==');
for (const t of db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").all()) {
  const cols = db.prepare(`pragma table_info("${t.name}")`).all().map((c) => c.name);
  console.log(`  ${t.name}: ${cols.join(', ')}`);
}

const hasWl = db.prepare("select name from sqlite_master where type='table' and name='dividend_watchlist'").get();
if (hasWl) {
  console.log('\n== dividend_watchlist ==');
  for (const r of db.prepare('select * from dividend_watchlist order by id').all()) {
    console.log('  ' + JSON.stringify(r));
  }
}

db.close();
