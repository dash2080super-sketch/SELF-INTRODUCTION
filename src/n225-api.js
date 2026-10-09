import express from 'express';
import { getN225, refreshN225 } from './n225-data.js';

export const n225Router = express.Router();

/**
 * GET /api/n225
 *   ?refresh=1  真刷新：起子进程重跑 daily_advice.py，等新数据落盘再返回。
 *               失败/超时会返回旧数据 + _refresh.msg 说明原因，不让前端空转。
 *   不带参数    读盘（1 分钟内存缓存）。
 *
 * 返回 daily_advice.py 落下的 latest.json + 最近 30 条判定历史。
 */
n225Router.get('/', async (req, res) => {
  const force = req.query.refresh === '1';
  try {
    res.json(force ? await refreshN225() : getN225(false));
  } catch (e) {
    res.json({ ...getN225(true), _refresh: { ok: false, msg: `刷新异常：${e.message}` } });
  }
});
