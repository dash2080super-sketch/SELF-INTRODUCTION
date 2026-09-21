import express from 'express';
import { getFinance, writeManual, readManual, invalidate, stats, modeNow } from './finance-data.js';
import { MANUAL_IDS } from './finance-catalog.js';

export const financeRouter = express.Router();

/**
 * GET /api/finance
 *   ?refresh=1  强制刷新（会真的打上游，别频繁用）
 *   不带参数时走分级缓存：新鲜的数据一个请求都不发。
 * 响应里的 meta 带分级年龄、上游请求计数、当前模式（active / idle），
 * 前端用它显示"更新于 N 秒前"和实时档的倒计时。
 */
financeRouter.get('/', async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    if (force) invalidate();
    const data = await getFinance(req.app.locals.db, force);
    res.json(data);
  } catch (e) {
    console.error('[finance]', e);
    res.status(500).json({ error: '行情拉取失败：' + e.message });
  }
});

/** 运行状态，用来看资源开销。
 *  mode 要现算：刷新只在客户端请求时触发，光看 stats.mode 会停在旧值。 */
financeRouter.get('/stats', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    ...stats,
    mode: modeNow(),
    heapMB: +(mem.heapUsed / 1048576).toFixed(1),
    rssMB: +(mem.rss / 1048576).toFixed(1),
    uptimeMin: +(process.uptime() / 60).toFixed(1),
  });
});

/** 手动录入：{ id, value, date, note } */
financeRouter.put('/manual', (req, res) => {
  try {
    const { id, value, date, note } = req.body || {};
    if (!MANUAL_IDS.includes(id)) return res.status(400).json({ error: '该指标不支持手动录入' });
    const saved = writeManual(req.app.locals.db, id, {
      value: value === '' || value == null ? null : Number(value),
      date: date || '',
      note: note || '',
    });
    res.json({ ok: true, id, value: saved });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

financeRouter.get('/manual', (req, res) => res.json({ manual: readManual(req.app.locals.db) }));
