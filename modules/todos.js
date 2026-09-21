export default {
  id: 'todos',
  name: 'To-Do',
  icon: '✓',
  desc: '要办的事，别让脑子记',
  order: 10,
  quickAdd: true,
  table: 'todos',
  orderBy: `done ASC,
            CASE priority WHEN '高' THEN 0 WHEN '中' THEN 1 ELSE 2 END ASC,
            COALESCE(due_date, '9999-12-31') ASC,
            created_at DESC`,
  ddl: `
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      due_date TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT '中',
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_todos_done ON todos(done);
  `,
  fields: [
    { key: 'content', label: '要办的事', type: 'text', required: true, search: true, placeholder: '例如：给房东转房租' },
    { key: 'priority', label: '优先级', type: 'select', options: ['高', '中', '低'], default: '中' },
    { key: 'due_date', label: '截止日期', type: 'date' },
    { key: 'note', label: '备注', type: 'textarea', placeholder: '补充说明、上下文、下一步动作' },
    { key: 'done', label: '已完成', type: 'boolean', default: false },
  ],
};
