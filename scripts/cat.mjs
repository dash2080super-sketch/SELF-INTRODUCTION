// 查看源码的行区间或搜索，绕开宿主工具对含 emoji 文件的二进制误判。
// 用法：
//   node scripts/cat.mjs <file> [start] [end]        # 打印第 start~end 行（1 起，含两端）
//   node scripts/cat.mjs <file> --grep <re>          # 打印匹配行（支持中文）
import fs from 'node:fs';

const [file, a, b] = process.argv.slice(2);
if (!file) {
  console.error('用法: node scripts/cat.mjs <file> [start] [end] | <file> --grep <re>');
  process.exit(1);
}
const lines = fs.readFileSync(file, 'utf8').split('\n');

if (a === '--grep') {
  let re;
  try {
    re = new RegExp(b, 'i');
  } catch (e) {
    console.error('正则无效: ' + e.message);
    process.exit(1);
  }
  let n = 0;
  lines.forEach((l, i) => {
    if (re.test(l)) {
      n++;
      console.log(`${String(i + 1).padStart(4)} | ${l}`);
    }
  });
  console.log(`--- 命中 ${n} 行 / 共 ${lines.length} 行 ---`);
} else {
  const s = Math.max(1, parseInt(a || '1', 10));
  const e = Math.min(lines.length, parseInt(b || String(s + 40), 10));
  for (let i = s; i <= e; i++) console.log(`${String(i).padStart(4)} | ${lines[i - 1]}`);
  console.log(`--- 显示 ${s}~${e} 行 / 共 ${lines.length} 行 ---`);
}
