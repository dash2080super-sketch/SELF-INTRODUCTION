/**
 * globalradar —— Global Radar 全球指数雷达（virtual: 不建表，不生成 CRUD）。
 *
 * 页面本体是一个独立的 Python 服务：127.0.0.1:8787（/opt/globalradar，systemd: globalradar.service）。
 * 它由 server.js 里的 /global-radar 反代暴露出来，这里只在 billboard 里占一个 tab，用 iframe 嵌进来。
 *
 * 为什么用 iframe（和 timing 一个道理，别改成 innerHTML 注入）：
 *   1. innerHTML 塞进去的 <script> 不会执行，ECharts 图表会全部失效；
 *   2. 雷达自带 style.css，用了 .card / .tbl / .tab 这类通用类名，会和 app.css 互相覆盖；
 *   3. 往 head 注入 <style> 的话，切换 tab 时不会被移除，会污染其他模块。
 *
 * 服务端配套：server.js 里挂了一条 /global-radar 反代（在 authGuard 之后，需登录）。
 */
export default {
  id: 'globalradar',
  name: 'Global Radar',
  icon: '📡',
  desc: '全球指数 · 股指期货 · 利率曲线 · 大宗 · 技术形态 · QDII溢价',
  order: 57,
  virtual: true,
  fields: [],
  slots: [],
};
