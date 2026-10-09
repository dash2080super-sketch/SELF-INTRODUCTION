/* 贴图收藏夹 —— 在 billboard 的 tab 里用 iframe 嵌入独立静态页 /clipimg/index.html。
 *
 * iframe 理由同 timing/life：自包含页面、样式隔离、切 tab 可整体卸载。
 * 高度算法照抄 timing.js 的实测结论（topbar 折行 + 100dvh 修正）。
 *
 * 【为什么要在外层再挂一遍粘贴/拖入监听】
 * 页面文案写的是"在页面任意位置 Ctrl+V"，但 iframe 里的 document 拿不到焦点时，
 * 粘贴事件只在外层文档冒泡，iframe 里的监听器一个都收不到 —— 用户按了 Cmd+V
 * 什么反应都没有，也没提示。2026-10-10 用真键盘实测确认过：
 *   焦点在 iframe 内 → Cmd+V 正常上传；焦点在外层页面 → 完全没反应。
 * 而 billboard 是 iframe 嵌 tab，用户切过去时焦点默认在外层，所以这个坑几乎必踩。
 * 这里把外层的粘贴/拖入转发进 iframe，用户就不用先"点进那张白纸"了。
 */
window.Billboard.register('clipimg', {
  async mount(ctx) {
    const frame = document.createElement('iframe');
    frame.src = '/clipimg/index.html';
    frame.title = '贴图收藏夹';
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

    const post = (msg) => {
      try {
        frame.contentWindow?.postMessage(msg, location.origin);
      } catch {
        /* iframe 还没 load 完就丢了这一下，用户可以再贴一次 */
      }
    };
    // 只有这一栏在前台时才接管粘贴，别在其他 tab 里也把图片吞了
    const isActive = () => ctx.panel.classList.contains('active');

    const pickImages = (list) => [...list].filter((f) => f && f.type && f.type.indexOf('image/') === 0);

    const onPaste = (e) => {
      if (!isActive()) return;
      const files = [];
      for (const it of e.clipboardData?.items || []) {
        if (it.type && it.type.indexOf('image/') === 0) {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (!files.length) return; // 不是图片就别抢，页面里可能还有别的输入框
      e.preventDefault();
      post({ source: 'clipimg', kind: 'files', files });
    };

    const onDrop = (e) => {
      if (!isActive()) return;
      const files = pickImages(e.dataTransfer?.files || []);
      if (!files.length) return;
      e.preventDefault();
      post({ source: 'clipimg', kind: 'files', files });
    };

    // 兜住拖拽，不然文件拖到外层页面会被浏览器直接打开
    const onDragOver = (e) => {
      if (isActive() && e.dataTransfer) e.preventDefault();
    };

    // 回到这一栏时让 iframe 重新拉一次列表（mount 只跑一次，iframe 会一直活着）
    const onHash = () => {
      if (location.hash === '#clipimg') post({ source: 'clipimg', kind: 'refresh' });
    };

    document.addEventListener('paste', onPaste);
    document.addEventListener('drop', onDrop);
    document.addEventListener('dragover', onDragOver);
    window.addEventListener('hashchange', onHash);
    frame.addEventListener('load', () => {
      if (isActive()) post({ source: 'clipimg', kind: 'refresh' });
    });
  },
});
