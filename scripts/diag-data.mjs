// 数据丢失诊断：当前库 vs 备份，以及所有可能的恢复来源。
import fs from 'node:fs';
import Database from 'better-sqlite3';

const DB = process.env.DB || '/opt/billboard/data/billboard.db';
const TABLES = ['todos', 'thoughts', 'words', 'sentences'];

function show(p) {
  console.log(`\n=== ${p} ===`);
  if (!fs.existsSync(p)) return console.log('  不存在');
  const st = fs.statSync(p);
  console.log(`  ${st.size} 字节, mtime ${st.mtime.toISOString()}`);
  let db;
  try {
    db = new Database(p, { readonly: true });
  } catch (e) {
    return console.log('  打不开: ' + e.message);
  }
  const tables = db.prepare("select name from sqlite_master where type='table' order by name").all().map((r) => r.name);
  console.log('  表: ' + tables.join(', '));
  for (const t of TABLES) {
    if (!tables.includes(t)) continue;
    try {
      const c = db.prepare(`select count(*) c from ${t}`).get().c;
      const mx = db.prepare(`select coalesce(max(id),0) m from ${t}`).get().m;
      console.log(`    ${t.padEnd(10)} ${String(c).padStart(3)} 行  max(id)=${mx}`);
    } catch (e) {
      console.log(`    ${t.padEnd(10)} 读不了: ${e.message}`);
    }
  }
  db.close();
}

console.log('=== /opt/billboard/data 目录 ===');
for (const f of fs.readdirSync('/opt/billboard/data')) {
  const st = fs.statSync(`/opt/billboard/data/${f}`);
  console.log(`  ${f}  ${st.size} 字节  ${st.mtime.toISOString()}`);
}

console.log('\n=== /opt/backup ===');
if (fs.existsSync('/opt/backup')) {
  const l = fs.readdirSync('/opt/backup');
  console.log('  ' + (l.length ? l.join(', ') : '(空目录)'));
} else console.log('  目录不存在');

console.log('\n=== 其它可能的库副本 ===');
const cands = [];
for (const dir of ['/tmp', '/opt', '/root', '/opt/billboard']) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (/\.(db|sqlite|sqlite3|tar\.gz|zip)$/i.test(f) || /billboard.*(bak|backup)/i.test(f)) {
      try {
        const st = fs.statSync(`${dir}/${f}`);
        if (st.isFile()) cands.push(`${dir}/${f}  ${st.size}B  ${st.mtime.toISOString()}`);
      } catch {}
    }
  }
}
console.log(cands.length ? cands.map((c) => '  ' + c).join('\n') : '  (无)');

show(DB);
const bk = fs.existsSync('/opt/backup') ? fs.readdirSync('/opt/backup').filter((f) => f.endsWith('.db')).sort() : [];
for (const f of bk) show(`/opt/backup/${f}`);

console.log('\n=== 表结构 ===');
const db = new Database(DB, { readonly: true });
for (const t of TABLES) {
  try {
    console.log('  ' + db.prepare("select sql from sqlite_master where name=?").get(t).sql.replace(/\s+/g, ' '));
  } catch (e) {
    console.log(`  ${t}: ${e.message}`);
  }
}
db.close();
