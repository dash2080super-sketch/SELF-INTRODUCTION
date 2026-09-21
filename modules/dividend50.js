/**
 * dividend50 —— 红利 50 专区。
 *
 * 典范标的：515450 红利低波50ETF南方。
 * virtual: true → 不走自动 CRUD，数据全在 src/dividend50.js 里算，接口 /api/dividend50。
 *
 * 与 dividend（个股高股息）并列，但回答的问题不同：
 *   那边是「这只股票现在便不便宜」，这边是「这笔钱现在该买、该等、还是该卖，买多少」。
 */
export default {
  id: 'dividend50',
  name: '红利50',
  icon: '50',
  desc: '红利低波 515450 · 六档建议（强烈买入 / 买入 / 小额 / 等待 / 减仓 / 卖出）· 股债利差 + 布林带 + 拥挤度',
  order: 56,
  virtual: true,
  fields: [],
  slots: [],
};
