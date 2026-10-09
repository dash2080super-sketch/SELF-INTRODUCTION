/**
 * vocab —— 词汇实验室。
 *
 * 虚拟模块：页面本体是自包含单文件 public/vocab/index.html（server.js 已整目录静态服务），
 * 前端 public/js/modules/vocab.js 用 iframe 把它嵌进 tab。
 *
 * 数据侧走 src/vocab-api.js 的 /api/vocab/*（服务端抓 vocabulary.com 并解析，
 * 浏览器直连会被 CORS 挡住，发音音频在国内也直连不稳，所以统一走本站代理）。
 *
 * order 放 31 —— 紧挨着 Word List(30)，这两栏是同一件事的两面（收集 vs 精读），
 * 而且默认排到最后会在 tab 栏被挤到屏幕外（现在已经有 17 个 tab 了）。
 */
export default {
  id: 'vocab',
  name: '词汇实验室',
  icon: '🔬',
  desc: 'vocabulary.com 词条精读：音标 / 发音 / 义项 / 同义词，例句可按来源（文学、新闻、商业…）筛选',
  order: 31,
  virtual: true,
  fields: [],
  slots: [],
};
