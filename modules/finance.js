/**
 * finance —— 行情看板（virtual: 不建表，不生成 CRUD）。
 * 数据全部由 src/finance-catalog.js + src/finance-data.js 提供，
 * 经 /api/finance 一次性返回（含指标定义、实时数值、注解文案）。
 * 后端缓存 60 秒；前端打开面板时拉一次，之后每 60 秒自动刷新。
 */
export default {
  id: 'finance',
  name: 'Finance',
  icon: '¥',
  desc: '全球行情看板 · 情绪 / 波动率 / 股指 / 利率 / 汇率商品',
  order: 50,
  virtual: true,
  fields: [],
  slots: [],
};
