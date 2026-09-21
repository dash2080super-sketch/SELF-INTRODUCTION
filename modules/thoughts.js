export default {
  id: 'thoughts',
  name: '随想',
  icon: '💡',
  desc: '一闪而过的念头、小事、半成品想法',
  order: 20,
  quickAdd: true,
  table: 'thoughts',
  orderBy: 'created_at DESC',
  ddl: `
    CREATE TABLE IF NOT EXISTS thoughts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_thoughts_created ON thoughts(created_at DESC);
  `,
  fields: [
    { key: 'content', label: '随想', type: 'textarea', required: true, search: true, placeholder: '想到什么就写什么' },
    { key: 'tag', label: '标签', type: 'text', search: true, placeholder: '生活 / 工作 / 灵感' },
    { key: 'pinned', label: '置顶', type: 'boolean', default: false },
  ],
};
