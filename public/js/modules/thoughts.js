const { esc, fmtTime } = window.Billboard;

window.Billboard.register('thoughts', {
  renderItem(item) {
    return `
      <div class="item-title">${esc(item.content)}</div>
      <div class="item-meta">
        ${item.pinned ? '<span class="chip blue">置顶</span>' : ''}
        ${item.tag ? `<span class="chip">${esc(item.tag)}</span>` : ''}
        <span class="chip">${fmtTime(item.created_at)}</span>
      </div>`;
  },
});
