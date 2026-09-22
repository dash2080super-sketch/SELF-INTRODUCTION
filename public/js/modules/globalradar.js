/* Global Radar —— 在 billboard 的 tab 里用 iframe 嵌入 /global-radar/。
 *
 * 用 iframe 而不是直接渲染的原因（别改成 innerHTML 注入）：
 *   1. innerHTML 塞进去的 <script> 不会执行，ECharts 图表会全部失效；
 *   2. 雷达自带 style.css，用了 .card / .tbl / .tab 这类通用类名，会和 app.css 互相覆盖；
 *   3. 往 head 注入 <style> 的话，切换 tab 时不会被移除，会污染其他模块。
 *
 * 因此这里全部使用内联样式，不注入任何 <style> 标签。
 * 高度沿用 timing 的实测值：topbar 约 56px + main 上下 padding 40px + body 底部 40px。
 */
window.Billboard.register('globalradar', {
  async mount(ctx) {
    const frame = document.createElement('iframe');
    frame.src = '/global-radar/';
    frame.title = 'Global Radar 全球指数雷达';
    frame.setAttribute('loading', 'lazy');
    Object.assign(frame.style, {
      width: '100%',
      height: 'calc(100vh - 140px)',
      minHeight: '700px',
      border: '0',
      display: 'block',
      borderRadius: '10px',
      background: '#f6f7f9',
    });
    ctx.panel.appendChild(frame);
  },
});
