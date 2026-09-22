/**
 * 让 Global Radar 在 billboard 里铺满屏幕。
 *
 * 三层原因：
 *  1. billboard 的 main 默认 max-width:1040px（app.css:51）→ 舞台只占屏幕中间一条；
 *  2. 雷达自带 tech-layout 是 grid 1fr + 340px 侧栏，宽度只有 1040 时左栏被压到 ~670px，
 *     而它的 ECharts 图表自己有固定像素高度（.chart.huge = 620px），所以是又窄又高；
 *  3. 窗口变宽后图表不会自动长高（.chart 高度是写死的 px）。
 *
 * 本补丁：
 *  A. app.css 末尾加一条和 life 同款的宽屏规则 → main 撑到 1600px；
 *  B. 往雷达的 static/index.html 注入一小段覆盖 CSS + JS，只在「被 iframe 嵌进 billboard 时」生效
 *     （靠 referrer 判断 orion 场景，直接访问 vic-jianhua.me/global-radar/ 完全不受影响）：
 *       - tech-layout 变为 1fr + 380px；
 *       - 图表高度由固定 px 改为随视口长的 calc()，K线图能撑到 ~1000px+ 看细节；
 *       - 加 ResizeObserver，宽度变化时 echarts.resize()，窗口拉宽图表会跟着长高。
 *
 * 幂等：已打过直接退出。每处改动前先备份，HTML 注入追加在 </body> 前（可回滚）。
 */
import fs from 'node:fs';

const APP_CSS = '/opt/billboard/public/css/app.css';
const GR_HTML = '/opt/globalradar/static/index.html';
const MARK = '/* billboard-embed-fill */';
const JS_MARK = 'billboard-embed-fill';

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
const backups = [];
function backup(f) {
  const b = `${f}.bak-fill-${stamp}`;
  fs.copyFileSync(f, b);
  backups.push(b);
  return b;
}
function rollback() {
  for (const b of backups) {
    const orig = b.replace(/\.bak-fill-.*$/, '');
    fs.copyFileSync(b, orig);
    console.log('[fill] 已回滚:', orig);
  }
}
function read(f) {
  return fs.readFileSync(f, 'utf8');
}

// ---------- A. billboard：让 main 给 iframe 更大的舞台 ----------
let css = read(APP_CSS);
if (css.includes(MARK)) {
  console.log('[fill] app.css 已打过，跳过 A');
} else {
  backup(APP_CSS);
  if (!css.endsWith('\n')) css += '\n';
  css += `
/* Global Radar：iframe 需要宽一点的舞台（和 life 同理） ${MARK} */
main:has(> .panel[data-id="globalradar"].active){max-width:1600px}
`;
  fs.writeFileSync(APP_CSS, css);
  console.log('[fill] A 完成: app.css 已加宽屏规则');
}

// ---------- B. 雷达页面：仅在 iframe 嵌入时自适应铺满 ----------
let html = read(GR_HTML);
if (html.includes(JS_MARK)) {
  console.log('[fill] index.html 已打过，跳过 B');
} else {
  backup(GR_HTML);
  const inject = `
<style>
/* 只在「被 billboard 用 iframe 嵌进来」时生效（靠 referrer 判断），
   直接访问 https://vic-jianhua.me/global-radar/ 时这段完全不起作用。 ${MARK} */
</style>
<script>
/* ${JS_MARK} —— 嵌入时铺满：图表高度随视口长，宽度变化自动 resize */
(function () {
  var embedded = false;
  try {
    embedded = window.self !== window.top &&
      /\\/global-radar/.test(document.referrer || '');
  } catch (e) { embedded = false; }
  if (!embedded) return;

  var style = document.createElement('style');
  style.textContent = [
    /* 右侧信息栏给足宽度，左栏（K线）才能拿到剩下的全部空间 */
    '.tech-layout{grid-template-columns:1fr 380px}',
    '@media (max-width:1200px){.tech-layout{grid-template-columns:1fr}}',
    /* 图表高度：固定 px 改成随视口长的 calc，窗口越高图越大 */
    '.chart{height:clamp(280px, 34vh, 460px)}',
    '.chart.big{height:clamp(340px, 42vh, 620px)}',
    '.chart.huge{height:clamp(520px, 76vh, 1100px)}',
    /* 页脚留白收一点，避免下方一大片空白 */
    'main{padding-bottom:28px}'
  ].join('');
  document.head.appendChild(style);

  function fit() {
    var charts = (window.S && window.S.charts) || null;
    if (charts) {
      Object.keys(charts).forEach(function (k) {
        try { charts[k].resize(); } catch (e) {}
      });
    }
    /* 兜底：挂在容器上的 echarts 实例（拿得到 _echarts_instance_ 属性） */
    Array.prototype.forEach.call(
      document.querySelectorAll('.chart, .chart-col > div'),
      function (el) {
        var inst = window.echarts && window.echarts.getInstanceByDom
          ? window.echarts.getInstanceByDom(el) : null;
        if (inst) { try { inst.resize(); } catch (e) {} }
      }
    );
  }

  /* 视口/容器尺寸变化就重算（窗口拉宽 → 图表变高变宽） */
  var ro = new ResizeObserver(function () { requestAnimationFrame(fit); });
  ro.observe(document.documentElement);
  ro.observe(document.body);
  window.addEventListener('resize', function () { requestAnimationFrame(fit); });
  /* 首屏与切 tab 后各补一次（图表是异步渲染的） */
  [80, 400, 1200].forEach(function (t) { setTimeout(fit, t); });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) setTimeout(fit, 120);
  });
})();
</script>
`;
  if (!html.includes('</body>')) {
    console.error('[fill] index.html 里找不到 </body>，中止');
    rollback();
    process.exit(1);
  }
  html = html.replace('</body>', inject + '</body>');
  fs.writeFileSync(GR_HTML, html);
  console.log('[fill] B 完成: index.html 已注入自适应样式与脚本');
}

console.log('[fill] 备份:', backups.join(', ') || '(无)');
