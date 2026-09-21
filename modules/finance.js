/**
 * finance —— 占位模块（virtual: 不建表，不生成 CRUD）。
 * 现在只做两件事：
 *   1) 在面板上占一个位置，展示"待接入"的指标槽（QQQ / VXN / 10Y / 原油）
 *   2) 用 kv 表存一份草稿笔记，想到什么先记着
 * 等你想清楚要什么指标/什么图，只要在这里补 ddl + fields，
 * 去掉 virtual 标志，它就自动变成完整 CRUD 模块，前端也不用大改。
 */
export default {
  id: 'finance',
  name: 'Finance',
  icon: '¥',
  desc: '财务 / 行情面板（结构待定，先占位）',
  order: 50,
  virtual: true,
  fields: [],
  slots: [
    { key: 'qqq', label: 'QQQ / NDX', hint: '纳斯达克100 主标' },
    { key: 'vxn', label: 'VXN', hint: '纳指波动率' },
    { key: 'ust10y', label: 'US 10Y', hint: '10 年期美债收益率' },
    { key: 'wti', label: 'WTI 原油', hint: '油价' },
  ],
};
