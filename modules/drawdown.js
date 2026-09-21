/**
 * drawdown —— 回撤与连跌（virtual: 不建表，不生成 CRUD）。
 * 数据由 src/drawdown-data.js 抓 Yahoo 日线，经 /api/drawdown 一次性返回。
 * 后端缓存 30 分钟；前端打开面板时拉一次，之后每 5 分钟自动刷新。
 */
export default {
  id: 'drawdown',
  name: '回撤连跌',
  icon: '📉',
  desc: '全球股指 · 每日收盘 / 回撤 / 连涨连跌',
  order: 52,
  virtual: true,
  fields: [],
  slots: [],
};
