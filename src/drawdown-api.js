import express from 'express';
import { getDrawdown, invalidate, stats, INDEXES } from './drawdown-data.js';

export const drawdownRouter = express.Router();

/**
 * GET /api/drawdown
 *   ?refresh=1  强制刷新（会真的打上游）
 *   不带参数走 30 分钟缓存；没人看的时候一个上游请求都不发。
 * 返回的是原始日线（每个指数最近 3 个月的收盘价），
 * 回撤、连涨连跌这些由前端按所选窗口现算，切窗口不再打上游。
 */
drawdownRouter.get('/', async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    if (force) invalidate();
    const data = await getDrawdown(force);
    res.json(data);
  } catch (e) {
    console.error('[drawdown]', e);
    res.status(500).json({ error: '日线拉取失败：' + e.message });
  }
});

/** 运行状态，看开销用 */
drawdownRouter.get('/stats', (req, res) => {
  res.json({ ...stats, heapMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1) });
});

/** 标的清单（给前端兜底展示顺序用） */
drawdownRouter.get('/indexes', (req, res) => res.json({ indexes: INDEXES }));
