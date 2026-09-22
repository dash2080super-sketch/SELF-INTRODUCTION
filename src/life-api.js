/**
 * life —— 生活工作台（日常集）后端。
 *
 * 页面本体是一份自包含的单文件 HTML，放在独立目录 /opt/life-board 下，
 * 由 server.js 挂到 /life/（在 authGuard 之后，必须登录才能看）。
 * billboard 这边只占一个 tab，用 iframe 嵌进来，理由和 timing / globalradar 一样：
 * iframe 能给页面一个干净的样式作用域，不会和 app.css 打架。
 *
 * 数据全部落在这个 SQLite 里（八张表），浏览器 localStorage 只是离线缓存。
 * 前端每次改动会 diff 出「变更的行」推到 /sync，服务端在单个事务里落库。
 *
 *   life_money      记账流水
 *   life_plan       日程
 *   life_fitness    体重 / 体脂 / 热量
 *   life_shopping   待买清单
 *   life_media      书影音
 *   life_habit      习惯定义（勾选 / 计数 / 数值三种打卡方式）
 *   life_habit_log  每日打卡值，主键 (habit_id, date)
 *   life_settings   预算、目标、外观、筛选状态等配置（键值）
 */
import express from 'express';

export const LIFE_DDL = `
CREATE TABLE IF NOT EXISTS life_money (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL DEFAULT '',
  flow       TEXT NOT NULL DEFAULT 'expense',
  amount     REAL NOT NULL DEFAULT 0,
  category   TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  is_sample  INTEGER NOT NULL DEFAULT 0,
  created_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_life_money_date ON life_money(date);

CREATE TABLE IF NOT EXISTS life_plan (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL DEFAULT '',
  title      TEXT NOT NULL DEFAULT '',
  title_en   TEXT NOT NULL DEFAULT '',
  time_slot  TEXT NOT NULL DEFAULT '',
  list_name  TEXT NOT NULL DEFAULT '生活',
  priority   TEXT NOT NULL DEFAULT 'normal',
  note       TEXT NOT NULL DEFAULT '',
  remind     INTEGER NOT NULL DEFAULT 0,
  done       INTEGER NOT NULL DEFAULT 0,
  is_sample  INTEGER NOT NULL DEFAULT 0,
  created_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_life_plan_date ON life_plan(date);

CREATE TABLE IF NOT EXISTS life_fitness (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL DEFAULT '',
  weight     REAL NOT NULL DEFAULT 0,
  body_fat   REAL NOT NULL DEFAULT 0,
  calories   REAL NOT NULL DEFAULT 0,
  duration   REAL NOT NULL DEFAULT 0,
  note       TEXT NOT NULL DEFAULT '',
  is_sample  INTEGER NOT NULL DEFAULT 0,
  created_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_life_fitness_date ON life_fitness(date);

CREATE TABLE IF NOT EXISTS life_shopping (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  quantity   TEXT NOT NULL DEFAULT '',
  category   TEXT NOT NULL DEFAULT '',
  price      REAL NOT NULL DEFAULT 0,
  priority   TEXT NOT NULL DEFAULT 'normal',
  note       TEXT NOT NULL DEFAULT '',
  bought     INTEGER NOT NULL DEFAULT 0,
  bought_date TEXT NOT NULL DEFAULT '',
  is_sample  INTEGER NOT NULL DEFAULT 0,
  created_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS life_media (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL DEFAULT '电影',
  status     TEXT NOT NULL DEFAULT '想看',
  rating     INTEGER NOT NULL DEFAULT 0,
  review     TEXT NOT NULL DEFAULT '',
  cover      TEXT NOT NULL DEFAULT '',
  date       TEXT NOT NULL DEFAULT '',
  is_sample  INTEGER NOT NULL DEFAULT 0,
  created_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS life_habit (
  id         TEXT PRIMARY KEY,
  habit_key  TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL DEFAULT '',
  habit_type TEXT NOT NULL DEFAULT 'check',
  target     REAL NOT NULL DEFAULT 1,
  unit       TEXT NOT NULL DEFAULT '次',
  tone       TEXT NOT NULL DEFAULT 'sage',
  sort_no    INTEGER NOT NULL DEFAULT 0,
  is_sample  INTEGER NOT NULL DEFAULT 0,
  created_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS life_habit_log (
  habit_id   TEXT NOT NULL,
  date       TEXT NOT NULL,
  value      REAL NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (habit_id, date)
);
CREATE INDEX IF NOT EXISTS idx_life_habit_log_date ON life_habit_log(date);

CREATE TABLE IF NOT EXISTS life_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

/** 各类记录 -> 表名 / 主键 / 可写列。前端传过来的 upsert 行只认这些列，多余的丢弃。 */
const SPECS = {
  money: {
    table: 'life_money',
    pk: ['id'],
    cols: ['date', 'flow', 'amount', 'category', 'note', 'is_sample', 'created_ms'],
  },
  plan: {
    table: 'life_plan',
    pk: ['id'],
    cols: [
      'date', 'title', 'title_en', 'time_slot', 'list_name', 'priority',
      'note', 'remind', 'done', 'is_sample', 'created_ms',
    ],
  },
  fitness: {
    table: 'life_fitness',
    pk: ['id'],
    cols: ['date', 'weight', 'body_fat', 'calories', 'duration', 'note', 'is_sample', 'created_ms'],
  },
  shopping: {
    table: 'life_shopping',
    pk: ['id'],
    cols: [
      'name', 'quantity', 'category', 'price', 'priority',
      'note', 'bought', 'bought_date', 'is_sample', 'created_ms',
    ],
  },
  media: {
    table: 'life_media',
    pk: ['id'],
    cols: ['name', 'type', 'status', 'rating', 'review', 'cover', 'date', 'is_sample', 'created_ms'],
  },
  habit: {
    table: 'life_habit',
    pk: ['id'],
    cols: ['habit_key', 'name', 'habit_type', 'target', 'unit', 'tone', 'sort_no', 'is_sample'],
  },
  habitLog: {
    table: 'life_habit_log',
    pk: ['habit_id', 'date'],
    cols: ['value'],
  },
  settings: {
    table: 'life_settings',
    pk: ['key'],
    cols: ['value'],
  },
};

/**
 * 需要转成数字的列。注意这里刻意不含 life_settings.value 和 life_habit_log.value 的通用处理：
 * - settings.value 存的是 JSON 字符串，一旦走 Number() 就会变成 0，等于静默丢掉外观/画像/周计划；
 * - habitLog.value 前端本来就是 Number 推上来的，SQLite 的 REAL 亲和也会自己兜住。
 * 真正的按列收敛放在 SPEC_NUMS 里，宁缺勿滥。
 */
const NUMERIC = new Set([
  'amount', 'target', 'rating', 'price', 'weight', 'body_fat',
  'calories', 'duration', 'is_sample', 'remind', 'done', 'bought',
  'sort_no', 'created_ms',
]);

/** 某些集合还额外需要数字列（其余一概按字符串处理）。 */
const SPEC_NUMS = { habitLog: new Set(['value']) };

function clean(col, raw, name) {
  const numeric = NUMERIC.has(col) || (SPEC_NUMS[name] && SPEC_NUMS[name].has(col));
  if (numeric) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return raw == null ? '' : String(raw);
}

/** 落一批 upsert / remove，返回受影响行数。 */
function applyCollection(db, name, payload) {
  const spec = SPECS[name];
  if (!spec || !payload || typeof payload !== 'object') return 0;

  const upserts = Array.isArray(payload.upsert) ? payload.upsert : [];
  const removes = Array.isArray(payload.remove) ? payload.remove : [];
  let touched = 0;

  if (upserts.length) {
    const cols = spec.pk.concat(spec.cols);
    const marks = cols.map(() => '?').join(',');
    const sets = spec.cols.map((c) => `${c} = excluded.${c}`).join(', ');
    const stmt = db.prepare(
      `INSERT INTO ${spec.table} (${cols.join(',')}) VALUES (${marks})
       ON CONFLICT(${spec.pk.join(',')}) DO UPDATE SET ${sets}, updated_at = datetime('now')`
    );
    for (const row of upserts) {
      if (!row || typeof row !== 'object') continue;
      const values = cols.map((c) => clean(c, row[c], name));
      // 主键为空的行直接丢弃，避免塞进去一堆同 key 的空 row
      if (spec.pk.some((c, i) => values[i] === '' || values[i] == null)) continue;
      stmt.run(...values);
      touched++;
    }
  }

  if (removes.length) {
    if (spec.pk.length === 1) {
      const stmt = db.prepare(`DELETE FROM ${spec.table} WHERE ${spec.pk[0]} = ?`);
      for (const key of removes) {
        if (key == null || key === '') continue;
        stmt.run(String(key));
        touched++;
      }
    } else {
      const where = spec.pk.map((c) => `${c} = ?`).join(' AND ');
      const stmt = db.prepare(`DELETE FROM ${spec.table} WHERE ${where}`);
      for (const key of removes) {
        const parts = String(key ?? '').split('|');
        if (parts.length !== spec.pk.length) continue;
        stmt.run(...parts);
        touched++;
      }
    }
  }

  return touched;
}

/** 一次性把线上所有数据读出来，页面开启时拉这一份就够。 */
function readAll(db) {
  const settings = {};
  for (const row of db.prepare('SELECT key, value FROM life_settings').all()) {
    settings[row.key] = row.value;
  }
  return {
    money: db.prepare('SELECT * FROM life_money ORDER BY date, created_ms').all(),
    plan: db.prepare('SELECT * FROM life_plan ORDER BY date, created_ms').all(),
    fitness: db.prepare('SELECT * FROM life_fitness ORDER BY date, created_ms').all(),
    shopping: db.prepare('SELECT * FROM life_shopping ORDER BY created_ms').all(),
    media: db.prepare('SELECT * FROM life_media ORDER BY date DESC, created_ms DESC').all(),
    // habit 不靠 created_ms 排序：它是 Pure Def 表，rowid 就是稳定的先后顺序
    habit: db.prepare('SELECT * FROM life_habit ORDER BY sort_no, rowid').all(),
    habitLog: db.prepare('SELECT habit_id, date, value FROM life_habit_log ORDER BY date').all(),
    settings,
    counts: {
      money: db.prepare('SELECT COUNT(*) c FROM life_money').get().c,
      plan: db.prepare('SELECT COUNT(*) c FROM life_plan').get().c,
      fitness: db.prepare('SELECT COUNT(*) c FROM life_fitness').get().c,
      shopping: db.prepare('SELECT COUNT(*) c FROM life_shopping').get().c,
      media: db.prepare('SELECT COUNT(*) c FROM life_media').get().c,
      habit: db.prepare('SELECT COUNT(*) c FROM life_habit').get().c,
      habitLog: db.prepare('SELECT COUNT(*) c FROM life_habit_log').get().c,
    },
  };
}

/** 建一张新表时用它；老表补列时用它（SQLite 的 ALTER 不能带 NOT NULL PRIMARY KEY 这类约束）。 */
const COL_TYPE = {
  amount: 'REAL DEFAULT 0', target: 'REAL DEFAULT 0', value: 'REAL DEFAULT 0',
  price: 'REAL DEFAULT 0', weight: 'REAL DEFAULT 0', body_fat: 'REAL DEFAULT 0',
  calories: 'REAL DEFAULT 0', duration: 'REAL DEFAULT 0',
  rating: 'INTEGER DEFAULT 0', is_sample: 'INTEGER DEFAULT 0', remind: 'INTEGER DEFAULT 0',
  done: 'INTEGER DEFAULT 0', bought: 'INTEGER DEFAULT 0', sort_no: 'INTEGER DEFAULT 0',
  created_ms: 'INTEGER DEFAULT 0',
};

/** 有些列前端不传但对排序/排错有用，也一并要求它们存在。 */
const EXTRA_COLUMNS = { life_habit: ['created_ms'] };

/**
 * 建表 + 给老表补齐后来才加的列。
 * CREATE TABLE IF NOT EXISTS 对「表已存在但少一列」是无能为力的，
 * 所以每次启动都对着 SPECS 核对一遍列名，缺哪个 ALTER 哪个。
 */
export function initLifeTables(db) {
  db.exec(LIFE_DDL);
  const missing = [];
  for (const spec of Object.values(SPECS)) {
    const rows = db.prepare(`PRAGMA table_info(${spec.table})`).all();
    if (!rows.length) continue;
    const existing = new Set(rows.map((c) => c.name));
    const wanted = spec.cols.concat(EXTRA_COLUMNS[spec.table] || []);
    for (const col of wanted) {
      if (existing.has(col)) continue;
      db.exec(`ALTER TABLE ${spec.table} ADD COLUMN ${col} ${COL_TYPE[col] || "TEXT DEFAULT ''"}`);
      missing.push(`${spec.table}.${col}`);
    }
  }
  if (missing.length) console.log('[life] 已补齐缺失列:', missing.join(', '));
}

export const lifeRouter = express.Router();

lifeRouter.get('/all', (req, res) => {
  try {
    res.json({ ok: true, data: readAll(req.app.locals.db) });
  } catch (e) {
    console.error('[life] 读取失败:', e.message);
    res.status(500).json({ error: '读取失败：' + e.message });
  }
});

/**
 * POST /sync —— 前端把「相对上一次同步，改动了哪些行」算好，整包推过来。
 * 一次事务落完，中途出错整体回滚，不会出现半份数据。
 */
lifeRouter.post('/sync', (req, res) => {
  const db = req.app.locals.db;
  const body = req.body || {};
  const order = ['money', 'plan', 'fitness', 'shopping', 'media', 'habit', 'habitLog', 'settings'];
  let touched = 0;
  try {
    const run = db.transaction(() => {
      for (const name of order) touched += applyCollection(db, name, body[name]);
    });
    run();
  } catch (e) {
    console.error('[life] 写入失败:', e.message);
    return res.status(500).json({ error: '写入失败：' + e.message });
  }
  res.json({ ok: true, touched, syncedAt: new Date().toISOString() });
});

/** 导出整份数据（前端的 JSON 备份走的也是这份结构）。 */
lifeRouter.get('/export', (req, res) => {
  try {
    res.json({
      module: 'life',
      exportedAt: new Date().toISOString(),
      ...readAll(req.app.locals.db),
    });
  } catch (e) {
    res.status(500).json({ error: '导出失败：' + e.message });
  }
});

/** 清空全部数据 —— 前端「清空数据」按钮用，需二次确认。 */
lifeRouter.delete('/all', (req, res) => {
  const db = req.app.locals.db;
  try {
    db.transaction(() => {
      for (const spec of Object.values(SPECS)) db.prepare(`DELETE FROM ${spec.table}`).run();
    })();
    res.json({ ok: true, cleared: true });
  } catch (e) {
    console.error('[life] 清空失败:', e.message);
    res.status(500).json({ error: '清空失败：' + e.message });
  }
});
