/**
 * 波段工作台的 HTTP 接口。
 *
 *   GET    /api/swing/quotes?refresh=1   watch 列表 + 实时行情 + 信号（前端唯一需要的读接口）
 *   GET    /api/swing/watch              原始 watch 列表（不含行情）
 *   POST   /api/swing/watch              新增 {code, buy_price, sell_price, buy_color, sell_color, note, sort}
 *   PATCH  /api/swing/watch/:id          修改任意字段
 *   DELETE /api/swing/watch/:id          删除
 *   GET    /api/swing/resolve?code=700   只看 code 会被解析成什么 + 当前价格（新增前的预览）
 *
 * 写操作要把 code 归一化成 secid（通用 CRUD 没这个介入时机，所以这里自己实现）。
 */
import express from 'express';
import { getDB } from './db.js';
import { getSnapshot, startWarmer, normalizeSecid, fetchOne } from './swing-data.js';

export const swingRouter = express.Router();

const CREATE_COLS = ['code', 'buy_price', 'sell_price', 'buy_color', 'sell_color', 'note', 'sort', 'enabled'];
const PATCH_COLS = ['code', 'buy_price', 'sell_price', 'buy_color', 'sell_color', 'note', 'sort', 'enabled'];

const COLORS = new Set(['pink', 'red', 'orange', 'blue', 'green', 'purple']);

startWarmer();

function clean(body, cols) {
  const out = {};
  for (const c of cols) if (c in body) out[c] = body[c];
  return out;
}

function normalizeBody(b) {
  if (b.code != null) {
    const n = normalizeSecid(b.code);
    if (!n) return { error: '代码看不懂，请检查：6 位数字为 A 股（600519 / 000858），港股可直接写 700' };
    b.code = n.code;
    b.secid = n.secid;
    b.market = n.market;
  }
  if (b.buy_price != null) b.buy_price = Number(b.buy_price) || 0;
  if (b.sell_price != null) b.sell_price = Number(b.sell_price) || 0;
  if (b.sort != null) b.sort = Number(b.sort) || 0;
  if (b.enabled != null) b.enabled = b.enabled ? 1 : 0;
  if (b.buy_color != null && !COLORS.has(b.buy_color)) b.buy_color = 'pink';
  if (b.sell_color != null && !COLORS.has(b.sell_color)) b.sell_color = 'red';
  if (b.note != null) b.note = String(b.note).slice(0, 200);
  return null;
}

swingRouter.get('/quotes', async (req, res) => {
  try {
    const snap = await getSnapshot(req.query.refresh === '1');
    res.json(snap);
  } catch (e) {
    res.status(502).json({
      error: `行情拉取失败：${e.message}`,
      items: [],
      fetchedAt: new Date().toISOString(),
      stale: true,
    });
  }
});

swingRouter.get('/watch', (req, res) => {
  const db = getDB();
  res.json({ items: db.prepare('SELECT * FROM swing_watch ORDER BY sort DESC, id ASC').all() });
});

swingRouter.post('/watch', (req, res) => {
  const db = getDB();
  const body = clean(req.body || {}, CREATE_COLS);
  const err = normalizeBody(body);
  if (err) return res.status(400).json(err);
  if (!body.code) return res.status(400).json({ error: '缺少代码' });

  const dup = db.prepare('SELECT id FROM swing_watch WHERE secid = ?').get(body.secid);
  if (dup) return res.status(409).json({ error: '这个标的已经在列表里了' });

  const cols = ['secid', 'market', ...Object.keys(body)];
  const marks = cols.map(() => '?').join(', ');
  const info = db
    .prepare(`INSERT INTO swing_watch (${cols.join(', ')}) VALUES (${marks})`)
    .run(...cols.map((c) => body[c]));
  res.json({ item: db.prepare('SELECT * FROM swing_watch WHERE id = ?').get(info.lastInsertRowid) });
});

swingRouter.patch('/watch/:id', (req, res) => {
  const db = getDB();
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM swing_watch WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const body = clean(req.body || {}, PATCH_COLS);
  const err = normalizeBody(body);
  if (err) return res.status(400).json(err);
  if (!Object.keys(body).length) return res.status(400).json({ error: '没有可更新的字段' });

  // 换代码的话，名称和小数位必须作废重爬 —— 留着旧值会静默算出错误的价格。
  if (body.secid) {
    body.name = '';
    body.decimals = 0;
  }
  const sets = Object.keys(body).map((k) => `${k} = ?`);
  db.prepare(`UPDATE swing_watch SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(
    ...Object.values(body),
    id
  );
  res.json({ item: db.prepare('SELECT * FROM swing_watch WHERE id = ?').get(id) });
});

swingRouter.delete('/watch/:id', (req, res) => {
  const db = getDB();
  const info = db.prepare('DELETE FROM swing_watch WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true, deleted: info.changes });
});

/** 新增前的预览：把输入解析成 secid，并返回当前价，方便用户直接填阈值 */
swingRouter.get('/resolve', async (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) return res.status(400).json({ error: '缺少 code' });
  const n = normalizeSecid(code);
  if (!n) return res.json({ ok: false, error: '无法识别的代码格式' });
  const one = await fetchOne(n.secid).catch(() => null);
  res.json({
    ok: true,
    input: code,
    secid: n.secid,
    market: n.market,
    code: n.code,
    name: one?.name || '',
    price: one?.price ?? null,
    decimals: one?.decimals ?? null,
  });
});

export { fetchOne };
