/**
 * etf —— ETF / 场内标的看板（virtual: 不建表，不生成 CRUD）。
 *
 * 页面本体是自包含静态页：public/etf/index.html（billboard 静态目录下，URL 即 /etf/index.html）
 *   · 自带 <style>、自带 ECharts（本地 vendor，不依赖 CDN）
 *   · K线 / 溢价率 / 资金流 / 概况，数据走 /api/etf/*
 * 这里只占一个 tab，用 iframe 嵌进来（理由同 timing：innerHTML 注入的 <script> 不执行、
 * 通用类名会和 app.css 打架、注入的 <style> 切走不会自动移除）。
 *
 * 服务端配套：server.js 里挂了 /api/etf 路由（在 authGuard 之后，需登录）。
 */
export default {
  id: 'etf',
  name: 'ETF看板',
  icon: '📈',
  desc: '场内标的：实时价 / 溢价率 / K线+指标 / 资金流 / 基金概况',
  order: 55,
  virtual: true,
  fields: [],
  slots: [],
};
