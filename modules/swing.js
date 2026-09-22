/**
 * swing —— 波段工作台。
 *
 * virtual: true → 不走通用 CRUD（watch 表由 src/swing-api.js 自己管），
 *                 因为 code → secid 的规范化、名称与小数位的回填都需要在写库时算好，
 *                 通用 CRUD 没有介入时机。和 life 模块一个套路。
 *
 * 服务端配套：
 *   - src/swing-api.js   GET /api/swing/quotes（watch 列表 + 实时行情 + 信号）
 *                        CRUD /api/swing/watch
 *   - src/swing-data.js  行情抓取 + 内存缓存 + 后台预热
 *   - server.js          app.use('/api/swing', swingRouter) + initSwingTables(db)
 *
 * 设计要点：
 *   1. 行情由服务端抓，浏览器不直连东财 —— 避免跨域，也避免把上游打爆。
 *   2. 价格口径用东财返回的 f59（小数位数）动态换算，A 股多为 2 位、ETF/港股多为 3 位。
 *      硬编码 /1000 会把腾讯 454.6 算成 0.4546 这种笑话。
 *   3. decimals 首次抓到后落库，之后只用批量接口（一次请求拿全部，约 4s）。
 */
export default {
  id: 'swing',
  name: '波段工作台',
  icon: '📈',
  desc: 'A股 / 港股自选 · 到价换色提醒（低于买点、高于卖点）· 后台取价，打开即最新',
  order: 59,
  virtual: true,
  fields: [],
  slots: [],
};
