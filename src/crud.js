import express from 'express';

// orderBy 来自模块定义（我们自己写的），仍做一次白名单以防误写导致注入
const ORDER_RE = /^[\w\s,.()'"+\-*/%]+$/i;

function safeOrderBy(orderBy) {
  const s = String(orderBy || 'created_at DESC');
  if (!ORDER_RE.test(s) || /;|--|\/\*/.test(s)) return 'created_at DESC';
  return s;
}

function coerce(val, field) {
  if (field.type === 'boolean') return val ? 1 : 0;
  if (field.type === 'number') return Number(val) || 0;
  if (val == null) return '';
  return String(val);
}

/**
 * 通用 CRUD 工厂：一个模块只要声明 表结构(ddl) + 字段(fields)，
 * 就自动获得 list / create / update / delete / export 五个接口。
 */
export function createCrudRouter(mod) {
  const router = express.Router();
  const table = mod.table || mod.id;
  const fields = mod.fields || [];
  const writable = fields.map((f) => f.key);
  const orderBy = safeOrderBy(mod.orderBy);
  const searchFields = fields.filter((f) => f.search).map((f) => f.key);

  router.get('/', (req, res) => {
    const db = req.app.locals.db;
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const offset = Number(req.query.offset) || 0;
    const q = (req.query.q || '').toString().trim();

    const where = [];
    const params = [];
    if (q && searchFields.length) {
      where.push('(' + searchFields.map((k) => `${k} LIKE ?`).join(' OR ') + ')');
      for (let i = 0; i < searchFields.length; i++) params.push(`%${q}%`);
    }
    // 允许按任意字段做精确过滤，例如 ?done=0
    for (const [k, v] of Object.entries(req.query)) {
      if (['limit', 'offset', 'q'].includes(k)) continue;
      if (!writable.includes(k)) continue;
      where.push(`${k} = ?`);
      params.push(v);
    }
    const sql = `SELECT * FROM ${table}${where.length ? ' WHERE ' + where.join(' AND ') : ''}
                 ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    const rows = db.prepare(sql).all(...params, limit, offset);
    res.json({ items: rows, count: rows.length });
  });

  router.post('/', (req, res) => {
    const db = req.app.locals.db;
    const body = req.body || {};
    const cols = ['created_at'];
    const marks = ["datetime('now')"];
    const args = [];
    for (const f of fields) {
      if (!(f.key in body)) {
        if (f.default !== undefined) {
          cols.push(f.key);
          marks.push('?');
          args.push(coerce(f.default, f));
        }
        continue;
      }
      cols.push(f.key);
      marks.push('?');
      args.push(coerce(body[f.key], f));
    }
    const info = db
      .prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${marks.join(',')})`)
      .run(...args);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
    res.json({ item: row });
  });

  router.patch('/:id', (req, res) => {
    const db = req.app.locals.db;
    const id = Number(req.params.id);
    const body = req.body || {};
    const sets = [];
    const args = [];
    for (const f of fields) {
      if (f.key in body) {
        sets.push(`${f.key} = ?`);
        args.push(coerce(body[f.key], f));
      }
    }
    if (!sets.length) return res.status(400).json({ error: '没有可更新的字段' });
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE ${table} SET ${sets.join(',')} WHERE id = ?`).run(...args, id);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json({ item: row });
  });

  router.delete('/:id', (req, res) => {
    const db = req.app.locals.db;
    const info = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(Number(req.params.id));
    res.json({ ok: true, deleted: info.changes });
  });

  router.get('/export', (req, res) => {
    const db = req.app.locals.db;
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all();
    res.json({ module: mod.id, exportedAt: new Date().toISOString(), items: rows });
  });

  return router;
}
