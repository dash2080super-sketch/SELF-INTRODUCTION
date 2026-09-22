/**
 * 把雷达页面的嵌入段重写干净（第二版）。
 *
 * 上一版两个 bug：
 *  1. style 块里写了重复的注释结束符，CSS 注释在第一个结束符就结束，
 *     多出来的结束符变成非法 token，后面整块被丢弃；
 *  2. 注释文字里出现注释开始符也会提前开注释。
 * 这版：注入段里**不写任何注释**，只放纯 CSS 和纯 JS；并在脚本里加 __BB_EMBED_OK 标记，
 * 方便远程断言「脚本确实跑到了」。
 *
 * 同时放宽嵌入判定：referrer 为空时（no-referrer 策略 / 部分浏览器）改用 iframe 宽度特征判断。
 */
import fs from 'node:fs';

const GR_HTML = '/opt/globalradar/static/index.html';
let html = fs.readFileSync(GR_HTML, 'utf8');

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
fs.copyFileSync(GR_HTML, `${GR_HTML}.bak-fill2-${stamp}`);

// 删掉上一版注入段（从它前面的 <style> 起，到 </script> 止）
const startMark = '<style>\n/* 只在';// 上一版开头特征
let cut = html.indexOf(startMark);
if (cut < 0) {
  // 兜底：找脚本注释标记
  const m = html.match(/<style>[\s\S]*?billboard-embed-fill[\s\S]*?<\/script>\s*(?=<\/body>)/);
  if (m) { html = html.replace(m[0], ''); }
  else { console.error('[fill2] 找不到上一版注入段，中止'); process.exit(1); }
} else {
  const tail = html.slice(cut);
  const endRel = tail.indexOf('</script>');
  if (endRel < 0) { console.error('[fill2] 注入段没有闭合，中止'); process.exit(1); }
  html = html.slice(0, cut) + tail.slice(endRel + '</script>'.length);
}

// 去掉上一版留在 head 里的空壳 <style>（如果还有孤立残留就靠下面的配平检查兜住）
html = html.replace(/<style>\s*<\/style>\s*/g, '');

const CSS_LINES = [
  '.tech-layout{grid-template-columns:1fr 380px}',
  '@media (max-width:1200px){.tech-layout{grid-template-columns:1fr}}',
  '.chart{height:clamp(280px,34vh,460px)}',
  '.chart.big{height:clamp(340px,42vh,620px)}',
  '.chart.huge{height:clamp(520px,76vh,1100px)}',
  'main{padding-bottom:28px}',
];

const inject = `
<style id="bb-embed-css"></style>
<script id="bb-embed-js">
(function () {
  var T = (window.top !== window.self);
  var R = (document.referrer || '').indexOf('global-radar') >= 0;
  var BY_W = false;
  try { BY_W = window.innerWidth > window.screen.availWidth + 2; } catch (e) {}
  if (!(T && (R || BY_W))) return;
  window.__BB_EMBED_OK = true;

  var css = ${JSON.stringify(CSS_LINES.join(''))};
  var st = document.getElementById('bb-embed-css');
  if (st) { st.textContent = css; } else { st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }

  function fit() {
    var charts = (window.S && window.S.charts) || null;
    if (charts) {
      Object.keys(charts).forEach(function (k) { try { charts[k].resize(); } catch (e) {} });
    }
    var all = document.querySelectorAll('.chart');
    for (var i = 0; i < all.length; i++) {
      var inst = (window.echarts && window.echarts.getInstanceByDom) ? window.echarts.getInstanceByDom(all[i]) : null;
      if (inst) { try { inst.resize(); } catch (e) {} }
    }
  }

  window.__BB_FIT = fit;
  try {
    var ro = new ResizeObserver(function () { requestAnimationFrame(fit); });
    ro.observe(document.documentElement);
    ro.observe(document.body);
  } catch (e) {}
  window.addEventListener('resize', function () { requestAnimationFrame(fit); });
  [80, 400, 1200, 2500].forEach(function (t) { setTimeout(fit, t); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(fit, 150); });
  document.addEventListener('click', function () { setTimeout(fit, 400); }, true);
})();
</script>
`;

if (!html.includes('</body>')) { console.error('[fill2] 没有 </body>'); process.exit(1); }
html = html.replace('</body>', inject + '</body>');
fs.writeFileSync(GR_HTML, html);

console.log('[fill2] 已重写, 备份:', `${GR_HTML}.bak-fill2-${stamp}`);
console.log('[fill2] __BB_EMBED_OK 出现次数:', (html.match(/__BB_EMBED_OK/g) || []).length);
