/* 日/德/法宏观 —— 在 billboard 的 tab 里用 iframe 嵌入 /jde-macro/index.html。
 *
 * 用 iframe 而不是直接渲染的原因（别改成 innerHTML 注入）：
 *   1. innerHTML 塞进去的 <script> 不会执行，ECharts 图表会全部失效；
 *   2. 手册自带完整 <style>，用了 .card / .tbl 这类通用类名，会和 app.css 互相覆盖；
 *   3. 往 head 注入 <style> 的话，切换 tab 时不会被移除，会污染其他模块。
 *
 * 因此这里全部使用内联样式，不注入任何 <style> 标签。
 * 高度沿用 globalradar 的实测值：topbar 约 56px + main 上下 padding 40px + body 底部 40px。
 *
 * src 必须写全 index.html：publicDir 的 express.static 是 index:false。
 * loading="lazy" —— 手册 1MB（含 echarts），别在首屏就跟其他 tab 抢带宽。
 */
window.Billboard.register('jdemacro', {
  async mount(ctx) {
    const frame = document.createElement('iframe');
    frame.src = '/jde-macro/index.html';
    frame.title = '日/德/法宏观 · 恐慌指数与情绪指标全景手册';
    frame.setAttribute('loading', 'lazy');
    Object.assign(frame.style, {
      width: '100%',
      minHeight: '480px',
      border: '0',
      display: 'block',
      borderRadius: '10px',
      background: '#f7f8fa',
    });
    // 高度不再写死「100vh - 140px」：移动端 topbar 会折行变高（品牌行 + tab 行约 100px），
    // 140px 的预留不够；且 iOS Safari 的 100vh 取「地址栏收起」的大视口，会把 iframe 底部顶到地址栏下面。
    // 按实测 topbar 高度算 + 用 100dvh（动态视口）修正。不支持 dvh 的浏览器会忽略第二行，保留 vh 兜底。
    // 84 = main 上下 padding(28) + body 底部留白(40) + 余量(16)
    const reserve = (document.querySelector('.topbar')?.offsetHeight || 56) + 84;
    frame.style.height = `calc(100vh - ${reserve}px)`;
    frame.style.height = `calc(100dvh - ${reserve}px)`;
    ctx.panel.appendChild(frame);
  },
});
