/**
 * jdemacro —— 日/德/法宏观（virtual: 不建表，不生成 CRUD）。
 *
 * 页面本体是一份自包含的单文件静态页：public/jde-macro/index.html，
 * 由 server.js 末尾的 express.static(publicDir) 直接托管 —— 那行在 authGuard 之后，
 * 所以登录保护自动继承，不需要（也不应该）再往 server.js 里加路由。
 *
 * 注意：publicDir 的 static 是 index:false，因此 iframe 的 src 必须写全
 * /jde-macro/index.html，写 /jde-macro/ 会 404。
 *
 * 为什么用 iframe（和 timing / globalradar 一个道理，别改成 innerHTML 注入）：
 *   1. innerHTML 塞进去的 <script> 不会执行，ECharts 图表会全部失效；
 *   2. 手册自带完整 <style>，用了 .card / .tbl 这类通用类名，会和 app.css 互相覆盖；
 *   3. 往 head 注入 <style> 的话，切换 tab 时不会被移除，会污染其他模块。
 *
 * 依赖：vendor/echarts.min.js（已本地化，不走 CDN —— 境外机房加载 jsdelivr 不稳）。
 */
export default {
  id: 'jdemacro',
  name: '日/德/法宏观',
  icon: '🌏',
  desc: '日経VI · VDAX · VSTOXX · VCAC · Sentix/ZEW/ifo — 阈值分档与官方查询入口',
  order: 60,
  virtual: true,
  fields: [],
  slots: [],
};
