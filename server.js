import express from 'express';
import cookieParser from 'cookie-parser';
import { config, assertConfig } from './src/config.js';
import { initDB } from './src/db.js';
import { loadModules, findModule, publicMeta } from './src/modules.js';
import { createCrudRouter } from './src/crud.js';
import { authGuard, handleLogin, handleLogout } from './src/auth.js';
import { kvRouter } from './src/kv.js';

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

app.use(
  express.static(config.publicDir, {
    maxAge: config.isProd ? '1h' : 0,
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
