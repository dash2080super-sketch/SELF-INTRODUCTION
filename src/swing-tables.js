/**
 * 波段工作台的建表 / 补列。
 *
 * 和 life 一个道理：CREATE TABLE IF NOT EXISTS 救不了「老表少一列」的情况，
 * 所以每次启动都对着 SPECS 做一次 PRAGMA 核对 + ALTER TABLE 补列。
 */
export function initSwingTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS swing_watch (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      code        TEXT    NOT NULL,
      secid       TEXT    NOT NULL DEFAULT '',
      market      TEXT    NOT NULL DEFAULT '',
      name        TEXT    NOT NULL DEFAULT '',
      decimals    INTEGER NOT NULL DEFAULT 0,
      buy_price   REAL    NOT NULL DEFAULT 0,
      sell_price  REAL    NOT NULL DEFAULT 0,
      buy_color   TEXT    NOT NULL DEFAULT 'pink',
      sell_color  TEXT    NOT NULL DEFAULT 'red',
      note        TEXT    NOT NULL DEFAULT '',
      sort        INTEGER NOT NULL DEFAULT 0,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_swing_secid ON swing_watch(secid);
    CREATE INDEX IF NOT EXISTS idx_swing_enabled ON swing_watch(enabled);
  `);

  const SPECS = {
    code: 'TEXT NOT NULL',
    secid: "TEXT NOT NULL DEFAULT ''",
    market: "TEXT NOT NULL DEFAULT ''",
    name: "TEXT NOT NULL DEFAULT ''",
    decimals: 'INTEGER NOT NULL DEFAULT 0',
    buy_price: 'REAL NOT NULL DEFAULT 0',
    sell_price: 'REAL NOT NULL DEFAULT 0',
    buy_color: "TEXT NOT NULL DEFAULT 'pink'",
    sell_color: "TEXT NOT NULL DEFAULT 'red'",
    note: "TEXT NOT NULL DEFAULT ''",
    sort: 'INTEGER NOT NULL DEFAULT 0',
    enabled: 'INTEGER NOT NULL DEFAULT 1',
  };

  const cols = db.prepare('PRAGMA table_info(swing_watch)').all();
  const have = new Map(cols.map((c) => [c.name, c]));
  const needAlter = [];
  for (const [name, ddl] of Object.entries(SPECS)) {
    if (!have.has(name)) needAlter.push(`ALTER TABLE swing_watch ADD COLUMN ${name} ${ddl}`);
    else {
      // REAL 亲和被建错会造成静默丢精度，发现类型不对就直接改
      const cur = String(have.get(name).type || '').toUpperCase();
      if (ddl.startsWith('REAL') && cur !== 'REAL') {
        needAlter.push(`ALTER TABLE swing_watch RENAME COLUMN ${name} TO ${name}_bad`);
        needAlter.push(`ALTER TABLE swing_watch ADD COLUMN ${name} REAL NOT NULL DEFAULT 0`);
      }
    }
  }
  for (const sql of needAlter) {
    try {
      db.exec(sql);
    } catch (e) {
      console.warn('[swing] 补列失败:', sql, e.message);
    }
  }
  return { added: needAlter.length };
}
