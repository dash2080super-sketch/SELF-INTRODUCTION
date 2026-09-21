const { esc, fmtTime } = window.Billboard;

const kindClass = { 难句: 'mid', 佳句: 'ok', 其他: '' };

window.Billboard.register('sentences', {
  renderItem(item) {
    return `
      <div class="item-title">${esc(item.content)}</div>
      ${item.translation ? `<div class="item-sub">${esc(item.translation)}</div>` : ''}
      ${item.note ? `<div class="item-sub" style="color:var(--muted)">${esc(item.note)}</div>` : ''}
      <div class="item-meta">
        <span class="chip ${kindClass[item.kind] || ''}">${esc(item.kind || '难句')}</span>
        ${item.source ? `<span class="chip">${esc(item.source)}</span>` : ''}
        <span class="chip">${fmtTime(item.created_at)}</span>
      </div>`;
  },
});
