/**
 * 修 patch-radar-fill.mjs 引入的 CSS 注释嵌套 bug。
 *
 * 我上次写的注释是：
 *     /* Global Radar：iframe 需要宽一点的舞台（和 life 同理） /* billboard-embed-fill *​/ *​/
 * 注释里又开了个 /* ，CSS 会一直吃到第一个 *​/ 才结束 —— 结果整条 :has() 规则被吞掉，
 * main 仍是 max-width:1040px，实测 mainW=1040 就是这个原因。
 *
 * 本补丁把结尾那行注释改成不含嵌套的写法。
 */
import fs from 'node:fs';

const F = '/opt/billboard/public/css/app.css';
let css = fs.readFileSync(F, 'utf8');

const BAD = '/* Global Radar：iframe 需要宽一点的舞台（和 life 同理） /* billboard-embed-fill */ */';
const GOOD = '/* Global Radar：iframe 需要宽一点的舞台（和 life 同理） billboard-embed-fill */';

if (!css.includes(BAD)) {
  // 兼容反斜杠转义等各种可能写法：用正则兜底
  const re = /\/\* Global Radar[^\n]*\*\/\s*\*\//;
  if (!re.test(css)) {
    if (css.includes('main:has(> .panel[data-id="globalradar"].active){max-width:1600px}') &&
        /max-width:1600px\}?\s*$/.test(css.trim() + '') &&
        css.split('/*').length - 1 === css.split('*/').length - 1) {
      console.log('[fix] 看起来已经修过了，跳过');
      process.exit(0);
    }
    console.error('[fix] 找不到目标注释行，中止');
    process.exit(1);
  }
  css = css.replace(re, '/* Global Radar：iframe 需要宽一点的舞台（和 life 同理） billboard-embed-fill */');
} else {
  css = css.replace(BAD, GOOD);
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
fs.copyFileSync(F, `${F}.bak-cmtfix-${stamp}`);
fs.writeFileSync(F, css);

// 自检：大括号与注释必须配平
const opens = (css.match(/\/\*/g) || []).length;
const closes = (css.match(/\*\//g) || []).length;
const lb = (css.match(/\{/g) || []).length;
const rb = (css.match(/\}/g) || []).length;
console.log(`[fix] 注释 ${opens}/${closes}  花括号 ${lb}/${rb}`);
if (opens !== closes || lb !== rb) {
  console.error('[fix] 配平检查失败，回滚');
  fs.copyFileSync(`${F}.bak-cmtfix-${stamp}`, F);
  process.exit(1);
}
console.log('[fix] 完成, 备份:', `${F}.bak-cmtfix-${stamp}`);
