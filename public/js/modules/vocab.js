/* 词汇实验室 —— 在 billboard 的 tab 里用 iframe 嵌入独立静态页 /vocab/index.html。
 *
 * iframe 理由同 timing/life/clipimg：自包含页面、样式隔离、切 tab 可整体卸载。
 * 高度算法照抄现有几个渲染器（topbar 折行 + 100dvh 修正）。
 */
window.Billboard.register('vocab', {
  async mount(ctx) {
    const frame = document.createElement('iframe');
    frame.src = '/vocab/index.html';
    frame.title = '词汇实验室';
    frame.setAttribute('loading', 'lazy');
    Object.assign(frame.style, {
      width: '100%',
      minHeight: '480px',
      border: '0',
      display: 'block',
      borderRadius: '10px',
      background: '#f4f5f7',
    });
    const reserve = (document.querySelector('.topbar')?.offsetHeight || 56) + 84;
    frame.style.height = `calc(100vh - ${reserve}px)`;
    frame.style.height = `calc(100dvh - ${reserve}px)`;
    ctx.panel.appendChild(frame);
  },
});
