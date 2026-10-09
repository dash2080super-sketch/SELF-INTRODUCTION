import express from 'express';
import { getNdxspx, refreshNdxspx } from './ndxspx-data.js';

export const ndxspxRouter = express.Router();

/**
 * GET /api/ndxspx
 *   ?refresh=1  真刷新：起子进程重跑 daily_decide.py，等新数据落盘再返回。
 *               失败/超时返回旧数据 + _refresh.msg 说明原因，不让前端空转。
 *   不带参数    读盘（1 分钟内存缓存）。
 *
 * 返回 latest.json（含两条腿的 ERP / 层级 / 金额 / 熔断 / 门 D）+ 最近 60 条判定历史。
 */
ndxspxRouter.get('/', async (req, res) => {
  const force = req.query.refresh === '1';
  try {
    res.json(force ? await refreshNdxspx() : getNdxspx(false));
  } catch (e) {
    res.json({ ...getNdxspx(true), _refresh: { ok: false, msg: `刷新异常：${e.message}` } });
  }
});
