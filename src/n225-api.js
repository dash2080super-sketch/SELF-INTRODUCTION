import express from 'express';
import { getN225 } from './n225-data.js';

export const n225Router = express.Router();

/**
 * GET /api/n225
 *   ?refresh=1  忽略内存缓存，重新读盘
 * 返回 daily_advice.py 落下的 latest.json + 最近 30 条判定历史。
 */
n225Router.get('/', (req, res) => {
  const force = req.query.refresh === '1';
  res.json(getN225(force));
});
