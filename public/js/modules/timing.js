/* A股择时看板 —— 在 billboard 的 tab 里用 iframe 嵌入独立静态页 /timing/index.html。
 *
 * 用 iframe 而不是直接渲染的原因（别改成 innerHTML 注入）：
 *   1. innerHTML 塞进去的 <script> 不会执行，ERP 计算器和 ECharts 图表会全部失效；
 *   2. 看板用了 .card / .metric / table 这类通用类名，会和 app.css 互相覆盖；
 *   3. 往 head 注入 <style> 的话，切换 tab 时不会被移除，会污染其他模块。
 *
 * 因此这里全部使用内联样式，不注入任何 <style> 标签。
 * 高度按 app.css 的实测布局算：topbar 约 56px + main 上下 padding 40px + body 底部 40px。
 */
window.Billboard.register('timing', {
  async mount(ctx) {
    const frame = document.createElement('iframe');
    frame.src = '/timing/index.html';
    frame.title = 'A股择时看板';
    frame.setAttribute('loading', 'lazy');
    Object.assign(frame.style, {
      width: '100%',
      height: 'calc(100vh - 140px)',
      minHeight: '560px',
      border: '0',
      display: 'block',
      borderRadius: '10px',
      background: '#f6f7f9',
    });
    ctx.panel.appendChild(frame);
  },
});
