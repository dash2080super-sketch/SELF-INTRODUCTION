/* 把 billboard 里「只在 VPS 上打过补丁、没进过 git」的挂载一次性补齐。
 *
 * 背景（2026-09-23 事故）：globalradar / life / swing 三个 tab 的挂载是以前用补丁脚本
 * 直接改 VPS 上的 server.js 加的，从来没 commit。一旦有人跑 deploy.sh（git pull --ff-only），
 * server.js 就被回滚成 origin/main 的版本，三个 tab 集体 404 —— 「Cannot GET /global-radar/」。
 * 更糟的是回滚后的 server.js 又被后续 commit 固化进 origin/main，光靠 pull 已经救不回来了。
 *
 * 所以这个脚本做两件事：
 *   1. 按锚点精确插回四处挂载（幂等，重复跑只会报「已存在，跳过」）；
 *   2. 提示把这些改动 commit + push，让 deploy.sh 再也冲不掉。
 *
 * 用法：node /opt/billboard/scripts/patch-mounts.mjs [--commit]
 *   --commit 会顺手 git add server.js 并 commit + push（幂等：无改动就不提交）。
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const SERVER = '/opt/billboard/server.js';
const log = [];

if (!fs.existsSync(SERVER)) throw new Error('找不到 ' + SERVER);
let src = fs.readFileSync(SERVER, 'utf8');

// 0) 备份（带时间戳，绝不覆盖旧备份）
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
fs.copyFileSync(SERVER, `${SERVER}.bak-mounts-${stamp}`);
log.push('已备份 -> server.js.bak-mounts-' + stamp);

function once(marker, apply, desc) {
  if (src.includes(marker)) {
    log.push('已存在，跳过：' + desc);
    return;
  }
  apply();
  log.push('已补回：' + desc);
}

// 1) node:http（globalradar 反代要用，不引第三方依赖）
once(
  "import http from 'node:http';",
  () => {
    const A = "import crypto from 'node:crypto';";
    if (!src.includes(A)) throw new Error('找不到 crypto import 锚点');
    src = src.replace(A, A + "\nimport http from 'node:http';");
  },
  "import http from 'node:http'"
);

// 2) life / swing 的 import（锚在 dividend50 之后）
once(
  "from './src/life-api.js'",
  () => {
    const A = "import { dividend50Router } from './src/dividend50-api.js';";
    if (!src.includes(A)) throw new Error('找不到 dividend50 import 锚点');
    src = src.replace(
      A,
      A +
        "\nimport { lifeRouter, initLifeTables } from './src/life-api.js';" +
        "\nimport { swingRouter } from './src/swing-api.js';" +
        "\nimport { initSwingTables } from './src/swing-tables.js';"
    );
  },
  'life / swing 的 import'
);

// 3) 建表
once(
  'initLifeTables(db)',
  () => {
    const A = 'const db = initDB(modules);';
    if (!src.includes(A)) throw new Error('找不到 initDB 锚点');
    src = src.replace(A, `${A}\ninitLifeTables(db);\ninitSwingTables(db);`);
  },
  'initLifeTables / initSwingTables'
);

// 4) API 路由
once(
  "app.use('/api/life', lifeRouter)",
  () => {
    const A = "app.use('/api/dividend', dividendRouter);";
    if (!src.includes(A)) throw new Error('找不到 dividend 路由锚点');
    src = src.replace(A, `${A}\napp.use('/api/life', lifeRouter);\napp.use('/api/swing', swingRouter);`);
  },
  '/api/life + /api/swing'
);

// 5) /global-radar 反代 + /life 静态目录（都必须在 authGuard 之后、首页处理之前）
const RADAR_BLOCK = [
  '// Global Radar：独立的 Python 服务（127.0.0.1:8787，systemd: globalradar.service）。',
  '// 挂在 /global-radar 下，放在 authGuard 之后 —— 必须登录才能看，和 /timing 一个待遇。',
  '// 用 node:http 手写一个最小反代，不引新依赖（node_modules 里没有 http-proxy-*）。',
  "const GR_UPSTREAM = process.env.GR_UPSTREAM || 'http://127.0.0.1:8787';",
  "app.use('/global-radar', (req, res) => {",
  '  // req.url 已被 express 剥掉 /global-radar 前缀，直接拼到上游即是最终路径',
  "  const target = new URL(req.url || '/', GR_UPSTREAM);",
  '  const headers = { ...req.headers };',
  '  delete headers.host;',
  '  delete headers.connection;',
  '  const up = http.request(target, { method: req.method, headers }, (pres) => {',
  '    res.status(pres.statusCode || 502);',
  '    for (const [k, v] of Object.entries(pres.headers)) {',
  "      if (k === 'transfer-encoding' || k === 'connection') continue;",
  '      res.set(k, v);',
  '    }',
  '    pres.pipe(res);',
  '  });',
  '  up.on(\'error\', (e) => {',
  "    console.error('[billboard] globalradar 反代失败:', e.message);",
  "    if (!res.headersSent) res.status(502).type('text/plain').send('Global Radar 未运行（502）');",
  '    else res.end();',
  '  });',
  '  req.pipe(up);',
  '});',
  '',
  '// 生活工作台（日常集）：一份自包含的单文件页面，放在独立目录里，',
  '// 避免它自带的 CSS 和 app.css 互相污染。放在 authGuard 之后 —— 必须登录才能看。',
  "const LIFE_DIR = process.env.LIFE_DIR || '/opt/life-board';",
  "app.use('/life', express.static(LIFE_DIR, { maxAge: 0, index: 'index.html', etag: true }));",
  '',
].join('\n');

once(
  "app.use('/global-radar'",
  () => {
    const A = 'app.get(/^\\/index\\.html$/, (req, res, next) => {';
    if (!src.includes(A)) throw new Error('找不到 index.html 锚点');
    src = src.replace(A, RADAR_BLOCK + A);
  },
  '/global-radar 反代 + /life 静态目录'
);

fs.writeFileSync(SERVER, src);
log.push('server.js 已写回');

console.log(log.join('\n'));

// ---- 可选：把这次改动固化到 git，免得下次 deploy.sh 又冲掉 ----
if (process.argv.includes('--commit')) {
  try {
    execFileSync('git', ['config', '--global', '--add', 'safe.directory', '/opt/billboard'], { cwd: '/opt/billboard' });
    execFileSync('git', ['add', 'server.js'], { cwd: '/opt/billboard' });
    const status = execFileSync('git', ['status', '--porcelain', 'server.js'], { cwd: '/opt/billboard' }).toString().trim();
    if (!status) {
      console.log('git: server.js 无改动，无需提交');
    } else {
      execFileSync(
        'git',
        ['-c', 'user.name=billboard', '-c', 'user.email=billboard@local', 'commit', '-m',
         'fix(mounts): 补回 global-radar 反代 / life 静态与 API / swing API 挂载（之前只打在 VPS 上，被 git pull 冲掉）'],
        { cwd: '/opt/billboard' }
      );
      console.log('git: 已提交');
      execFileSync('git', ['push', 'origin', 'main'], { cwd: '/opt/billboard' });
      console.log('git: 已推送 origin/main');
    }
  } catch (e) {
    console.log('git 步骤失败（服务本身不受影响）:', e.message);
  }
}
