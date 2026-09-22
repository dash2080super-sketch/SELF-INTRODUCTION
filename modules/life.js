/**
 * life —— 生活工作台（日常集）。
 *
 * 页面本体是一份自包含的单文件 HTML，跑在独立目录 /opt/life-board 里，
 * 由 server.js 挂到 /life/（在 authGuard 之后 —— 必须登录才能看），
 * 这里用 iframe 嵌进 billboard 占一个 tab。
 *
 * 为什么用 iframe 而不是直接注入 DOM（和 timing / globalradar 一个道理）：
 *   1. innerHTML 塞进去的 <script> 不会执行，整个页面的逻辑会全废；
 *   2. 它自带一整套 CSS，用了 .card / .row / .tab 这类通用类名，会和 app.css 互相覆盖；
 *   3. 往 <head> 里注入 <style> 的话，切走 tab 时不会被移除，会污染其它模块。
 *
 * 数据侧：虚拟模块不建 CRUD 路由，读写全部走 src/life-api.js 暴露的 /api/life/*
 * （SQLite 里的八张 life_* 表）。
 */
export default {
  id: 'life',
  name: '生活工作台',
  icon: '🌿',
  desc: '今日概览 · 记账理财 · 习惯健康 · 减脂健身 · 日程统筹 · 待买清单 · 书影音 · 时光档案（数据存在 VPS 数据库里，多设备同步）',
  order: 58,
  virtual: true,
  fields: [],
  slots: [],
};
