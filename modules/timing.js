/**
 * timing —— A股择时看板（virtual: 不建表，不生成 CRUD）。
 *
 * 页面本体是一个完全独立的静态页：/opt/astock-timing/index.html
 * （自带 <style>、自带 ECharts CDN、自带 ERP 计算器，源码见仓库 astock-timing/）。
 *
 * 这里只在 billboard 里占一个 tab，用 iframe 把它嵌进来。
 * 为什么不直接把 HTML 塞进 panel：
 *   1. innerHTML 注入的 <script> 不会执行，看板的计算器和图表会整个失效；
 *   2. 看板用了 .card / .metric / table / label 这类通用类名，和 app.css 会互相覆盖；
 *   3. 若在 head 注入 <style>，切换 tab 时它不会被移除，会污染其他模块。
 * iframe 是这里唯一能保证「脚本能跑 + 样式完全隔离 + 切走不留痕」的做法。
 *
 * 服务端配套：server.js 里挂了一条 /timing 静态路由（在 authGuard 之后，需登录）。
 */
export default {
  id: 'timing',
  name: 'A股择时',
  icon: '🎯',
  desc: '沪深300 ERP · 指标读数 / 仓位建议 / 定投倍数计算器',
  order: 53,
  virtual: true,
  fields: [],
  slots: [],
};
