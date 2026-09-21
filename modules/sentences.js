export default {
  id: 'sentences',
  name: 'Sentences',
  icon: '❝',
  desc: '难啃的句子，和值得偷走的句子',
  order: 40,
  quickAdd: true,
  table: 'sentences',
  orderBy: 'created_at DESC',
  ddl: `
    CREATE TABLE IF NOT EXISTS sentences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT '难句',
      translation TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sentences_kind ON sentences(kind);
  `,
  fields: [
    { key: 'content', label: '句子', type: 'textarea', required: true, search: true },
    { key: 'kind', label: '类型', type: 'select', options: ['难句', '佳句', '其他'], default: '难句' },
    { key: 'translation', label: '理解 / 译文', type: 'textarea', search: true },
    { key: 'note', label: '为什么记它', type: 'textarea', placeholder: '卡在哪个结构？还是这句话写得漂亮？' },
    { key: 'source', label: '出处', type: 'text', search: true, placeholder: '书名 / 文章 / 播客' },
  ],
};
