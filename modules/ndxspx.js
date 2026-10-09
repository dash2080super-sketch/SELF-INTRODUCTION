/**
 * ndxspx —— NASDAQ & S&P 加仓决策（virtual: 不建表，不生成 CRUD）。
 *
 * 数据来源：/opt/ndxspx/latest.json —— cron 每天跑 daily_decide.py 落下来的结果。
 * 判定逻辑（ERP 递推 / 阶梯分层 / 门 D / 熔断 / 金额分笔）全部只在 Python 侧存在一份，
 * Node 侧不重新实现任何一行，只做读盘 + 渲染。否则两边必然漂移。
 *
 * 这个面板回答的问题很简单：
 *   今天能不能加？能加哪条腿（SPY 还是 QQQ）？加多少？为什么？
 * 因子快照（VIX / VXN / F&G）按终裁 T10 是 **硬冻结 0% 权重**，只当观察项展示。
 */
export default {
  id: 'ndxspx',
  name: 'NASDAQ & S&P 决策',
  icon: '🇺🇸',
  desc: 'NDX / SPX 多因子加仓决策 · ERP 阶梯 + 门D + 熔断',
  order: 53,
  virtual: true,
  fields: [],
  slots: [],
};
