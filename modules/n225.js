/**
 * n225 —— N225策略（virtual: 不建表，不生成 CRUD）。
 * 数据不抓上游：直接读 /opt/nikkei/latest.json —— 那是 cron 每天 09:25 / 14:30
 * 跑 daily_advice.py 落下来的结果（同一台机器上，读文件最快也最省）。
 * 面板只做展示 + 最近决策历史，判定逻辑全在 Python 侧，两边不重复实现。
 */
export default {
  id: 'n225',
  name: 'N225策略',
  icon: '🇯🇵',
  desc: '日经225 ETF(513880) · 溢价闸门 + 金字塔档位 + 隔夜情绪',
  order: 54,
  virtual: true,
  fields: [],
  slots: [],
};
