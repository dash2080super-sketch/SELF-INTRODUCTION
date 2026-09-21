import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, assertConfig } from './src/config.js';
import { initDB } from './src/db.js';
import { loadModules, findModule, publicMeta } from './src/modules.js';
import { createCrudRouter } from './src/crud.js';
import { authGuard, handleLogin, handleLogout } from './src/auth.js';
import { kvRouter } from './src/kv.js';
import { financeRouter } from './src/finance-api.js';
import { drawdownRouter } from './src/drawdown-api.js';
import { dividendRouter } from './src/dividend-api.js';
import { dividend50Router } from './src/dividend50-api.js';

assertConfig();

const modules = await loadModules();
const db = initDB(modules);
for (const m of modules) {
  if (!m.virtual) m.router = createCrudRouter(m);
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.locals.db = db;
app.locals.modules = modules;

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ---- 公开路由（authGuard 白名单） ----
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
app.post('/api/login', handleLogin);

// ---- 其余全部需要登录 ----
app.use(authGuard);

app.post('/api/logout', handleLogout);
app.get('/api/me', (req, res) => res.json({ ok: true }));
app.get('/api/modules', (req, res) => res.json({ modules: publicMeta(modules) }));

app.use('/api/kv', kvRouter);
app.use('/api/finance', financeRouter);
app.use('/api/drawdown', drawdownRouter);
// dividend50 放前面：两条前缀都挂在 /api 下，先精确后宽松更省心
app.use('/api/dividend50', dividend50Router);
app.use('/api/dividend', dividendRouter);

app.use('/api/m/:moduleId', (req, res, next) => {
  const mod = findModule(modules, req.params.moduleId);
  if (!mod) return res.status(404).json({ error: 'no such module' });
  if (mod.virtual) {
    if (req.method === 'GET') {
      return res.json({ items: [], virtual: true, slots: mod.slots || [] });
    }
    return res.status(400).json({ error: '该模块还没有数据表，暂时不可写入' });
  }
  // 交给该模块的 CRUD 子路由。Express 挂载时通常已剥掉前缀，这里做兼容判断
  const prefix = `/api/m/${encodeURIComponent(req.params.moduleId)}`;
  const original = req.url;
  let rest = original.startsWith(prefix) ? original.slice(prefix.length) : original;
  if (!rest.startsWith('/')) rest = '/' + rest;
  req.url = rest;
  mod.router(req, res, (err) => {
    req.url = original;
    next(err);
  });
});

// ---- 静态资源版本号 ----
// 按 public/ 下所有文件的 mtime 算个短哈希，注入到首页的 __ASSET_V__ 占位符。
// 这样任何前端文件一改，URL 就变，浏览器不可能再吃到旧的 JS/CSS。
// 不需要手动 bump 版本号，重启服务即自动生效。
function computeAssetVersion() {
  const h = crypto.createHash('sha1');
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(`${e.name}:${fs.statSync(p).mtimeMs};`);
    }
  };
  try {
    walk(config.publicDir);
  } catch (e) {
    console.warn('[billboard] 计算资源版本失败:', e.message);
  }
  return h.digest('hex').slice(0, 8);
}
const ASSET_V = computeAssetVersion();

// 首页/登录页走这里，把占位符替换掉再发出去（放在 static 之前）
app.get(/^\/index\.html$/, (req, res, next) => {
  fs.readFile(path.join(config.publicDir, 'index.html'), 'utf8', (err, html) => {
    if (err) return next(err);
    res.set('Cache-Control', 'no-cache').type('html').send(html.replaceAll('__ASSET_V__', ASSET_V));
  });
});

app.use(
  express.static(config.publicDir, {
    // 个人小站，改动频繁：不设强缓存，靠 ETag 协商（304）省流量
    maxAge: 0,
    index: false,
    etag: true,
  })
);
app.get('/', (req, res) => res.redirect('/index.html'));

app.use((err, req, res, next) => {
  console.error('[billboard]', err);
  res.status(500).json({ error: 'server error' });
});

app.listen(config.port, config.host, () => {
  console.log(`[billboard] 运行中: http://${config.host}:${config.port}`);
  console.log(`[billboard] 已加载模块: ${modules.map((m) => m.id).join(', ')}`);
  console.log(`[billboard] 数据库: ${config.dbPath}`);
});
