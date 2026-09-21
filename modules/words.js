export default {
  id: 'words',
  name: 'Word List',
  icon: 'A',
  desc: '不会的词，记下来直到它变成你的',
  order: 30,
  quickAdd: true,
  table: 'words',
  orderBy: 'mastered ASC, created_at DESC',
  ddl: `
    CREATE TABLE IF NOT EXISTS words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL,
      phonetic TEXT NOT NULL DEFAULT '',
      meaning TEXT NOT NULL DEFAULT '',
      example TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      mastered INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_words_mastered ON words(mastered);
    CREATE INDEX IF NOT EXISTS idx_words_word ON words(word);
  `,
  fields: [
    { key: 'word', label: '单词 / 短语', type: 'text', required: true, search: true, placeholder: 'resilient' },
    { key: 'phonetic', label: '音标', type: 'text', placeholder: '/rɪˈzɪliənt/' },
    { key: 'meaning', label: '释义', type: 'textarea', search: true, placeholder: 'adj. 有韧性的，能快速恢复的' },
    { key: 'example', label: '例句', type: 'textarea', search: true },
    { key: 'source', label: '来源', type: 'text', search: true, placeholder: '哪篇文章 / 哪本书 / 哪个对话' },
    { key: 'mastered', label: '已掌握', type: 'boolean', default: false },
  ],
};
