/* 给 billboard 挂上「生活工作台」：后端 API + 静态页面 + tab 模块。
 * 只做精确的锚点替换，改完落盘，不做任何删除性操作。
 */
import fs from 'node:fs';

const SERVER = '/opt/billboard/server.js';
const CSS = '/opt/billboard/public/css/app.css';

let src = fs.readFileSync(SERVER, 'utf8');
const log = [];

// 0) 备份
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
fs.copyFileSync(SERVER, `${SERVER}.bak-life-${stamp}`);
log.push('已备份 server.js -> server.js.bak-life-' + stamp);

// 1) import
const ANCHOR_IMPORT = "import { dividend50Router } from './src/dividend50-api.js';";
if (!src.includes(ANCHOR_IMPORT)) throw new Error('找不到 import 锚点');
if (!src.includes("import { lifeRouter, initLifeTables }")) {
  src = src.replace(
    ANCHOR_IMPORT,
    ANCHOR_IMPORT + "\nimport { lifeRouter, initLifeTables } from './src/life-api.js';"
  );
  log.push('已加 import');
}

// 2) 建表
const ANCHOR_DB = 'const db = initDB(modules);';
if (!src.includes(ANCHOR_DB)) throw new Error('找不到 initDB 锚点');
if (!src.includes('initLifeTables(db)')) {
  src = src.replace(ANCHOR_DB, `${ANCHOR_DB}\ninitLifeTables(db);`);
  log.push('已加建表调用');
}

// 3) API 路由
const ANCHOR_ROUTE = "app.use('/api/dividend', dividendRouter);";
if (!src.includes(ANCHOR_ROUTE)) throw new Error('找不到 dividend 路由锚点');
if (!src.includes("app.use('/api/life', lifeRouter)")) {
  src = src.replace(ANCHOR_ROUTE, `${ANCHOR_ROUTE}\napp.use('/api/life', lifeRouter);`);
  log.push('已挂 /api/life');
}

// 4) 静态页面挂载 + 目录常量
const ANCHOR_STATIC = 'app.get(/^\\/index\\.html$/, (req, res, next) => {';
if (!src.includes(ANCHOR_STATIC)) throw new Error('找不到 index.html 锚点');
if (!src.includes("app.use('/life'")) {
  const block = [
    '// 生活工作台（日常集）：一份自包含的单文件页面，放在独立目录里，',
    '// 避免它自带的 CSS 和 app.css 互相污染。放在 authGuard 之后 —— 必须登录才能看。',
    'const LIFE_DIR = process.env.LIFE_DIR || \'/opt/life-board\';',
    "app.use('/life', express.static(LIFE_DIR, { maxAge: 0, index: 'index.html', etag: true }));",
    '',
    ANCHOR_STATIC,
  ].join('\n');
  src = src.replace(ANCHOR_STATIC, block);
  log.push('已挂 /life 静态目录');
}

fs.writeFileSync(SERVER, src);
log.push('server.js 已更新');

// 5) 给这个 tab 加宽一点 —— 原来的 1040px 衬托不起一面工作台
let css = fs.readFileSync(CSS, 'utf8');
const WIDE = '\n/* 生活工作台：iframe 需要宽一点的舞台 */\nmain:has(> .panel[data-id="life"].active){max-width:1400px}\n';
if (!css.includes('panel[data-id="life"]')) {
  fs.writeFileSync(CSS, css + WIDE);
  log.push('app.css 已追加宽屏规则');
} else {
  log.push('app.css 宽屏规则已存在，跳过');
}

console.log(log.join('\n'));
