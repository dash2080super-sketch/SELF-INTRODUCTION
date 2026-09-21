// 源码自检：① 编码体检（非法 UTF-8 / NUL 字节 / GBK 残留）② 语法解析（node --check，只解析不执行）
// 用法：node scripts/syntax-check.mjs [files...]   不给参数 = 全项目扫描
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SRC_EXT = /\.(js|mjs|css|html|json|sh|py)$/;
const SKIP_DIR = new Set(['node_modules', '.git', 'data', 'backup', 'tmp']);

function invalidUtf8(buf) {
  let i = 0, bad = 0;
  while (i < buf.length) {
    const b = buf[i];
    let need;
    if (b < 0x80) { i++; continue; }
    else if ((b & 0xe0) === 0xc0) need = 1;
    else if ((b & 0xf0) === 0xe0) need = 2;
    else if ((b & 0xf8) === 0xf0) need = 3;
    else { bad++; i++; continue; }
    let ok = true;
    for (let k = 1; k <= need; k++) {
      const c = buf[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) { ok = false; break; }
    }
    if (!ok) { bad++; i++; } else i += need + 1;
  }
  return bad;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (SRC_EXT.test(e.name)) out.push(p);
  }
  return out;
}

let files = process.argv.slice(2);
if (!files.length) {
  files = ['server.js', ...walk('src'), ...walk('modules'), ...walk('public'), ...walk('scripts')].filter((f) =>
    fs.existsSync(f)
  );
}

let encBad = 0, synBad = 0;

for (const f of files) {
  const buf = fs.readFileSync(f);
  const problems = [];
  if (buf.includes(0)) problems.push('含 NUL 字节');
  const inv = invalidUtf8(buf);
  if (inv) problems.push(`非法 UTF-8 字节 ×${inv}（很可能是 GBK 残留）`);
  if (problems.length) {
    encBad++;
    console.log(`ENC  ${f} -> ${problems.join('；')}`);
  }
  if (/\.(js|mjs)$/.test(f)) {
    try {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    } catch (e) {
      synBad++;
      const msg = (e.stderr || e.stdout || '').toString().split('\n').slice(0, 4).join(' ').trim();
      console.log(`SYN  ${f} -> ${msg || e.message}`);
    }
  }
}

console.log(
  `检查 ${files.length} 个文件 —— 编码问题 ${encBad} 个，语法问题 ${synBad} 个` +
    (encBad + synBad === 0 ? ' ✅' : ' ❌')
);
process.exit(encBad + synBad ? 1 : 0);
