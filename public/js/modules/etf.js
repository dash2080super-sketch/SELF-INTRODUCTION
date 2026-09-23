/* ETF看板 —— 在 tab 里用 iframe 嵌 /etf/index.html。
 *
 * 为什么用 iframe（别改成 innerHTML 注入，理由同 timing）：
 *   1. innerHTML 塞进去的 <script> 不会执行，ECharts 图表全部失效；
 *   2. 看板里的通用类名会和 app.css 互相覆盖；
 *   3. 往 head 注入 <style> 切走 tab 时不会移除，会污染其他模块。
 * 高度按 app.css 实测布局算：topbar 约 56px + main 上下 padding 40px + body 底部 40px。
 */
window.Billboard.register('etf', {
  async mount(ctx) {
    const frame = document.createElement('iframe');
    frame.src = '/etf/index.html';
    frame.title = 'ETF / 场内标的看板';
    frame.setAttribute('loading', 'lazy');
    Object.assign(frame.style, {
      width: '100%',
      height: 'calc(100vh - 140px)',
      minHeight: '620px',
      border: '0',
      display: 'block',
      borderRadius: '10px',
      background: '#f6f7f9',
    });
    ctx.panel.appendChild(frame);
  },
});
