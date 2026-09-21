/* finance：占位面板。
   现在显示"待接入指标"的槽位卡片 + 一个用 kv 存的草稿区。
   等确定要看什么数据后，在这里 fetch 行情 / 画图即可，数据层换掉不影响其他模块。 */
const { esc, toast, api } = window.Billboard;

window.Billboard.register('finance', {
  async mount(ctx) {
    const { mod, panel } = ctx;

    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = `<h2>Finance</h2><span class="desc">结构待定 · 先把位置占住</span>`;
    panel.appendChild(head);

    const slots = document.createElement('div');
    slots.className = 'slots';
    slots.innerHTML = (mod.slots || [])
      .map(
        (s) => `<div class="slot">
          <div class="k">${esc(s.label)}</div>
          <div class="v">—</div>
          <div class="h">${esc(s.hint)}</div>
        </div>`
      )
      .join('');
    panel.appendChild(slots);

    const note = document.createElement('div');
    note.className = 'item';
    note.style.cursor = 'default';
    note.innerHTML = `<div class="item-sub">这个面板等你想清楚要看什么再填。
      当前预留的槽位：QQQ/NDX、VXN（波动率）、10Y 美债、WTI 原油。
      接入方式有两种：定时抓取存进 SQLite 自己画，或直接嵌第三方图表。</div>`;
    panel.appendChild(note);

    const wrap = document.createElement('div');
    wrap.style.marginTop = '14px';
    wrap.innerHTML = `<div class="field"><label>随手草稿（想到什么先扔这儿，自动保存）</label>
      <textarea id="fin-draft" rows="6" placeholder="例如：想看 QQQ 回撤到 XX 时的加仓节奏…"></textarea></div>`;
    panel.appendChild(wrap);

    const ta = wrap.querySelector('#fin-draft');
    try {
      const r = await api.kvGet('finance.draft');
      ta.value = r.value || '';
    } catch {}

    let timer;
    ta.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          await api.kvSet('finance.draft', ta.value);
          toast('草稿已保存');
        } catch (e) {
          toast(e.message);
        }
      }, 800);
    };
  },
});
