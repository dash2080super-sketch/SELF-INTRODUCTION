/**
 * dividend50 —— 红利 50 专区接口。
 * GET /api/dividend50            （?refresh=1 强制忽略 30 秒缓存）
 * POST /api/dividend50/payout    更新派息日历（手动维护，改完立即生效）
 */
import express from 'express';
import { getDividend50, invalidate50, D50 } from './dividend50.js';

export const dividend50Router = express.Router();

dividend50Router.get('/', async (req, res) => {
  try {
    const data = await getDividend50({ force: req.query.refresh === '1' });
    res.json(data);
  } catch (e) {
    console.error('[dividend50]', e);
    res.status(500).json({ error: '红利50 数据拉取失败：' + e.message });
  }
});

/** 查看当前派息日历 */
dividend50Router.get('/payout', (req, res) => {
  res.json({ payout: D50.payout, asOf: D50.payoutAsOf });
});

/** 整份替换派息日历。body: { payout: [{exDate, perShare}], asOf } */
dividend50Router.post('/payout', (req, res) => {
  try {
    const { payout, asOf } = req.body || {};
    if (!Array.isArray(payout)) throw new Error('payout 要是数组：[{exDate, perShare}]');
    const clean = payout
      .map((p) => ({
        exDate: String(p.exDate || '').slice(0, 10),
        perShare: Number(p.perShare),
      }))
      .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.exDate) && Number.isFinite(p.perShare) && p.perShare > 0)
      .sort((a, b) => a.exDate.localeCompare(b.exDate));
    if (!clean.length) throw new Error('没有一条合法的派息记录');
    D50.payout = clean;
    D50.payoutAsOf = String(asOf || new Date().toISOString().slice(0, 10)).slice(0, 10);
    invalidate50();
    res.json({ ok: true, payout: D50.payout, asOf: D50.payoutAsOf });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
