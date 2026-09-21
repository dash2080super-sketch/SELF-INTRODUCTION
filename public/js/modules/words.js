const { esc, fmtTime } = window.Billboard;

window.Billboard.register('words', {
  renderItem(item) {
    return `
      <div class="item-title">${esc(item.word)}${item.phonetic ? ` <span class="chip">${esc(item.phonetic)}</span>` : ''}</div>
      ${item.meaning ? `<div class="item-sub">${esc(item.meaning)}</div>` : ''}
      ${item.example ? `<div class="item-sub" style="color:var(--muted);font-style:italic">${esc(item.example)}</div>` : ''}
      <div class="item-meta">
        <span class="chip ${item.mastered ? 'ok' : ''}">
          <input type="checkbox" data-act="toggle" data-field="mastered" ${item.mastered ? 'checked' : ''}>
          ${item.mastered ? '已掌握' : '还没掌握'}
        </span>
        ${item.source ? `<span class="chip">${esc(item.source)}</span>` : ''}
        <span class="chip">${fmtTime(item.created_at)}</span>
      </div>`;
  },
});
