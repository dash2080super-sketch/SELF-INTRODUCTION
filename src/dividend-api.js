import express from 'express';
import {
  getDividend,
  stats,
  invalidate,
  readWatchlist,
  addWatch,
  updateWatch,
  removeWatch,
} from './dividend-data.js';

export const dividendRouter = express.Router();

/**
 * GET /api/dividend
 *   ?refresh=1  强制忽略缓存重算（会真的打上游，别连点）
 * 返回：策略参数 + 国债锚 + 注解文案 + 每只关注标的的完整评估。
 */
dividendRouter.get('/', async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    const data = await getDividend(req.app.locals.db, { force });
    res.json(data);
  } catch (e) {
    console.error('[dividend]', e);
    res.status(500).json({ error: '红利数据拉取失败：' + e.message });
  }
});

/** 运行状态：用来看开销 */
dividendRouter.get('/stats', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    ...stats,
    heapMB: +(mem.heapUsed / 1048576).toFixed(1),
    rssMB: +(mem.rss / 1048576).toFixed(1),
    uptimeMin: +(process.uptime() / 60).toFixed(1),
  });
});

/* ---------------- 关注列表增删改 ---------------- */

dividendRouter.get('/watchlist', (req, res) => {
  try {
    res.json({ items: readWatchlist(req.app.locals.db) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

dividendRouter.post('/watchlist', (req, res) => {
  try {
    const { code, name, tag, note } = req.body || {};
    const c = addWatch(req.app.locals.db, { code, name, tag, note });
    res.json({ ok: true, code: c });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

dividendRouter.patch('/watchlist/:id', (req, res) => {
  try {
    const { name, tag, note } = req.body || {};
    updateWatch(req.app.locals.db, Number(req.params.id), { name, tag, note });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

dividendRouter.delete('/watchlist/:id', (req, res) => {
  try {
    removeWatch(req.app.locals.db, Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** 清缓存（改了策略参数后手动调一下） */
dividendRouter.post('/invalidate', (req, res) => {
  invalidate();
  res.json({ ok: true });
});
