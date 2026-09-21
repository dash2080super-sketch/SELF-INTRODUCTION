/* 只读：打印 billboard.db 里各表的行数，用来在跑破坏性脚本前后做对比。
 * 用法：node scripts/db-counts.mjs
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB || path.join(here, '..', 'data', 'billboard.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const tables = db
  .prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")
  .all()
  .map((r) => r.name);

const out = [];
for (const t of tables) {
  const n = db.prepare(`select count(*) c from "${t}"`).get().c;
  out.push(String(n).padStart(6) + '  ' + t);
}
console.log(`DB: ${dbPath}`);
console.log(out.join('\n'));
db.close();
