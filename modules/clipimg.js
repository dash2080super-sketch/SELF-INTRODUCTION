/**
 * clipimg —— 贴图收藏夹。
 *
 * 虚拟模块：页面本体是自包含单文件 public/clipimg/index.html，
 * server.js 已把 public/ 整目录静态服务（authGuard 之后），无需单独挂载。
 * 前端 public/js/modules/clipimg.js 用 iframe 把它嵌进 tab（理由同 timing/life）。
 *
 * 数据侧：上传/列表/取图/删除走 src/clipimg-api.js 的 /api/clipimg/*，
 * 图片文件存 data/clipimg/（data/ 在 .gitignore，不进仓库），索引是 index.json。
 */
export default {
  id: 'clipimg',
  name: '贴图收藏夹',
  icon: '📌',
  desc: 'Ctrl+V 粘贴截图即收藏（也支持拖拽 / 选文件），图片存 VPS，多设备同步',
  order: 59,
  virtual: true,
  fields: [],
  slots: [],
};
