import express from 'express';

/** 键值存储：给"结构还没想好"的模块（如 finance）放草稿/配置用 */
export const kvRouter = express.Router();

kvRouter.get('/:key', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare('SELECT value, updated_at FROM kv WHERE key = ?').get(req.params.key);
  res.json({ key: req.params.key, value: row ? row.value : '', updatedAt: row ? row.updated_at : null });
});

kvRouter.put('/:key', (req, res) => {
  const db = req.app.locals.db;
  const value = String((req.body && req.body.value) ?? '');
  db.prepare(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(req.params.key, value);
  res.json({ ok: true, key: req.params.key, value });
});
