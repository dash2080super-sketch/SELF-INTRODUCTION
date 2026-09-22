/* 生活工作台 —— 在 billboard 的 tab 里用 iframe 嵌入 /life/。
 *
 * 用 iframe 而不是直接渲染的原因（别改成 innerHTML 注入）：
 *   1. innerHTML 塞进去的 <script> 不会执行，页面逻辑会全部失效；
 *   2. 页面自带整套 CSS，用了很多通用类名，会和 app.css 互相覆盖；
 *   3. 往 head 注入 <style> 的话，切走 tab 时不会被移除，会污染其它模块。
 * 因此这里全部使用内联样式，不注入任何 <style> 标签。
 *
 * 高度沿用 timing / globalradar 的实测值：topbar 约 56px + main 上下 padding 40px + body 底部 40px。
 */
window.Billboard.register('life', {
  async mount(ctx) {
    const frame = document.createElement('iframe');
    frame.src = '/life/';
    frame.title = '生活工作台 · 日常集';
    frame.setAttribute('loading', 'lazy');
    Object.assign(frame.style, {
      width: '100%',
      height: 'calc(100vh - 140px)',
      minHeight: '760px',
      border: '0',
      display: 'block',
      borderRadius: '12px',
      background: '#faf7f4',
    });
    ctx.panel.appendChild(frame);
  },
});
