/**
 * dividend —— 高股息择时（红利策略）模块。
 *
 * virtual: true → 不走自动 CRUD，自己管数据；
 * ddl 里建自己的关注列表表（dividend_watchlist），
 * 接口全在 src/dividend-api.js。
 *
 * 判定逻辑：股息率相对「N 倍十年国债收益率」分档 → 定出买点价格网格；
 * 再看现价在日/周/月布林带下轨的什么位置 → 决定"等待 / 临近 / 买入共振"。
 */
export default {
  id: 'dividend',
  name: '高股息',
  icon: '息',
  desc: '红利择时 · 股息率网格 / 国债锚 / 日周月技术位置 / 质量检测',
  order: 55,
  virtual: true,
  fields: [],
  slots: [],
  ddl: `
CREATE TABLE IF NOT EXISTS dividend_watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  tag TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`,
};
