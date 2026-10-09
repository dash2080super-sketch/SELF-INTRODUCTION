/**
 * clipimg-api —— 贴图收藏夹 API（挂载点 /api/clipimg，挂在 authGuard 之后）。
 *
 * 上传：POST /api/clipimg?ext=png   body = 原始图片字节（Content-Type: image/*，
 *       会被全局 express.json 跳过，由本路由的 express.raw 接住，上限 30MB）
 * 列表：GET  /api/clipimg           → { items: [...] }，按时间倒序
 * 取图：GET  /api/clipimg/:id/file  → 图片文件（长缓存）
 * 删除：DELETE /api/clipimg/:id     → 删文件 + 删索引
 *
 * 存储：data/clipimg/<id>.<ext>；索引 data/clipimg/index.json，
 * 写入用 tmp+rename 原子替换，断电也不会写坏索引。
 * id 格式：20261009171234-a1b2c3（时间戳+随机），天然按时间排序且不冲突。
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.env.BILLBOARD_ROOT || '/opt/billboard';
const DIR = process.env.CLIPIMG_DIR || path.join(ROOT, 'data', 'clipimg');
const INDEX = path.join(DIR, 'index.json');
const ALLOWED = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']);

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

function loadIndex() {
  try {
    const list = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveIndex(list) {
  ensureDir();
  const tmp = INDEX + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list));
  fs.renameSync(tmp, INDEX);
}

const router = express.Router();

// 本路由统一收原始字节（json/urlencoded 解析器遇到 image/* 会自动跳过，不会抢）
router.use(express.raw({ type: () => true, limit: '30mb' }));

router.get('/', (req, res) => {
  const items = loadIndex().sort((a, b) => b.ts - a.ts);
  res.json({ items });
});

router.post('/', (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return res.status(400).json({ error: 'empty body' });
  }
  const ext = String(req.query.ext || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!ALLOWED.has(ext)) {
    return res.status(400).json({ error: 'unsupported ext: ' + ext });
  }
  ensureDir();
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:TZ]/g, '').slice(0, 14);
  const id = `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
  const file = `${id}.${ext}`;
  fs.writeFileSync(path.join(DIR, file), buf);
  const entry = {
    id,
    ext,
    size: buf.length,
    ts: now.getTime(),
    note: String(req.query.note || '').slice(0, 200),
  };
  const list = loadIndex();
  list.push(entry);
  saveIndex(list);
  res.status(201).json(entry);
});

router.get('/:id/file', (req, res) => {
  const it = loadIndex().find((x) => x.id === req.params.id);
  if (!it) return res.status(404).json({ error: 'not found' });
  const file = path.join(DIR, `${it.id}.${it.ext}`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'file missing' });
  res.sendFile(file, { maxAge: '30d', immutable: true });
});

router.delete('/:id', (req, res) => {
  const list = loadIndex();
  const i = list.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'not found' });
  try {
    fs.unlinkSync(path.join(DIR, `${list[i].id}.${list[i].ext}`));
  } catch {
    /* 文件已不在也照删索引 */
  }
  list.splice(i, 1);
  saveIndex(list);
  res.json({ ok: true });
});

export default router;
