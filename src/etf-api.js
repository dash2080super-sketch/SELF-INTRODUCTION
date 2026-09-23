import express from 'express';
import {
  getQuote,
  getKline,
  getFlow,
  getPremium,
  getFundInfo,
  searchETF,
  getSnapshot,
} from './etf-data.js';

export const etfRouter = express.Router();

const codeOf = (req) => String(req.query.code || '').trim();

/** 统一兜底：抓取失败也给 200 + error 字段，前端好处理，不至于整页崩掉 */
const wrap = (fn) => async (req, res) => {
  try {
    const data = await fn(req);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.json({ ok: false, error: e && e.message ? e.message : String(e) });
  }
};

/** GET /api/etf/snapshot?code=513850 —— 首屏一次性拿全（行情 + K线 + 溢价 + 资金流 + 概况） */
etfRouter.get('/snapshot', wrap(async (req) => {
  const code = codeOf(req);
  if (!code) throw new Error('缺少 code');
  return await getSnapshot(code, { days: req.query.days });
}));

/** GET /api/etf/quote?code=513850 —— 只刷实时价 */
etfRouter.get('/quote', wrap(async (req) => ({ quote: await getQuote(codeOf(req)) })));

/** GET /api/etf/kline?code=513850&klt=101&lmt=250 —— 切周期用 */
etfRouter.get('/kline', wrap(async (req) => {
  const klt = Number(req.query.klt) || 101;
  const lmt = Math.min(1000, Math.max(30, Number(req.query.lmt) || 250));
  return { kline: await getKline(codeOf(req), klt, lmt, 0) };
}));

/** GET /api/etf/flow?code=513850 */
etfRouter.get('/flow', wrap(async (req) => ({ flow: await getFlow(codeOf(req), 120) })));

/** GET /api/etf/premium?code=513850&days=120 */
etfRouter.get('/premium', wrap(async (req) => ({
  premium: await getPremium(codeOf(req), Math.min(300, Number(req.query.days) || 120)),
})));

/** GET /api/etf/info?code=513850 */
etfRouter.get('/info', wrap(async (req) => ({ info: await getFundInfo(codeOf(req)) })));

/** GET /api/etf/search?q=美国 —— 全市场 ETF 里按代码/名称搜 */
etfRouter.get('/search', wrap(async (req) => ({ items: await searchETF(req.query.q) })));
