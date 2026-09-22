/**
 * 把 /global-radar 反代补回 server.js。
 *
 * 背景：2026-09-22 10:40 那次 life 模块补丁从一个不含 radar 的基线重写了 server.js，
 * 导致 /global-radar 反代丢失 → 访问报 "Cannot GET /global-radar/"。
 * 上游 Python 服务（127.0.0.1:8787，systemd: globalradar.service）一直是好的。
 *
 * 幂等：已经打过就直接退出。
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const F = '/opt/billboard/server.js';
let src = fs.readFileSync(F, 'utf8');

if (src.includes("app.use('/global-radar'")) {
  console.log('[patch] /global-radar 已存在，跳过');
  process.exit(0);
}

// 1) 补 import http（手写最小反代要用，不引新依赖）
if (!/^import http from 'node:http';$/m.test(src)) {
  const anchorImport = "import crypto from 'node:crypto';";
  if (!src.includes(anchorImport)) {
    console.error('[patch] 找不到 import crypto 锚点，中止');
    process.exit(1);
  }
  src = src.replace(anchorImport, anchorImport + "\nimport http from 'node:http';");
}

// 2) 在 /timing 静态挂载之后插入反代
const anchor = "app.use('/timing', express.static(TIMING_DIR, { maxAge: 0, index: 'index.html', etag: true }));";
if (!src.includes(anchor)) {
  console.error('[patch] 找不到 /timing 锚点，中止');
  process.exit(1);
}

const block = `
// Global Radar：独立的 Python 服务（127.0.0.1:8787，systemd: globalradar.service）。
// 挂在 /global-radar 下，放在 authGuard 之后 —— 必须登录才能看，和 /timing 一个待遇。
// 用 node:http 手写一个最小反代，不引新依赖（node_modules 里没有 http-proxy-*）。
const GR_UPSTREAM = process.env.GR_UPSTREAM || 'http://127.0.0.1:8787';
app.use('/global-radar', (req, res) => {
  // req.url 已被 express 剥掉 /global-radar 前缀，直接拼到上游即是最终路径
  const target = new URL(req.url || '/', GR_UPSTREAM);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  const up = http.request(target, { method: req.method, headers }, (pres) => {
    res.status(pres.statusCode || 502);
    for (const [k, v] of Object.entries(pres.headers)) {
      if (k === 'transfer-encoding' || k === 'connection') continue;
      res.set(k, v);
    }
    pres.pipe(res);
  });
  up.on('error', (e) => {
    console.error('[billboard] globalradar 反代失败:', e.message);
    if (!res.headersSent) res.status(502).type('text/plain').send('Global Radar 未运行（502）');
    else res.end();
  });
  req.pipe(up);
});
`;

src = src.replace(anchor, anchor + '\n' + block);

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
const bak = `${F}.bak-radar-${stamp}`;
fs.copyFileSync(F, bak);
fs.writeFileSync(F, src);
console.log('[patch] 已写入, 备份:', bak);
try {
  execSync('node --check /opt/billboard/server.js', { stdio: 'inherit' });
  console.log('[patch] 语法检查通过');
} catch (e) {
  console.error('[patch] 语法检查失败，回滚');
  fs.copyFileSync(bak, F);
  process.exit(1);
}
