const { esc, fmtTime } = window.Billboard;

window.Billboard.register('todos', {
  renderItem(item) {
    const pcls = item.priority === '高' ? 'hi' : item.priority === '中' ? 'mid' : 'lo';
    const overdue = !item.done && item.due_date && item.due_date < new Date().toISOString().slice(0, 10);
    return `
      <div class="item-title">
        <input type="checkbox" data-act="toggle" data-field="done" ${item.done ? 'checked' : ''}>
        ${esc(item.content)}
      </div>
      ${item.note ? `<div class="item-sub">${esc(item.note)}</div>` : ''}
      <div class="item-meta">
        <span class="chip ${pcls}">${esc(item.priority || '中')}</span>
        ${item.due_date ? `<span class="chip ${overdue ? 'hi' : ''}">${overdue ? '已过期 ' : '截止 '}${esc(item.due_date)}</span>` : ''}
        <span class="chip">${fmtTime(item.created_at)}</span>
      </div>`;
  },
});
