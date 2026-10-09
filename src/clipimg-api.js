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

/**
 * 启动自检：存储目录必须能写。
 *
 * 2026-10-09 就是栽在这儿：目录是 root 建出来的（有人用 root 跑过服务或手动 mkdir），
 * 而 billboard 以 billboard 用户运行 → 只能读不能写，之后每一次粘贴都 500，
 * 当时前端还不管成败都喊"收藏完成 ✔"，用户看到的就是"收藏进去了但不显示"。
 * 与其等用户第一次粘贴才发现，不如启动就吵一声。
 */
function probeWritable() {
  try {
    ensureDir();
    const p = path.join(DIR, '.write-test');
    fs.writeFileSync(p, 'ok');
    fs.unlinkSync(p);
  } catch (e) {
    console.error(`[clipimg] ⚠ 存储目录不可写，粘贴收藏会全部失败：${DIR}`);
    console.error(`[clipimg] ⚠ 原因：${e.message}`);
    console.error(`[clipimg] ⚠ 修法：chown -R billboard:billboard ${DIR}`);
  }
}
probeWritable();

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
  try {
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
    // 写文件成功后再落索引；中间任何一步抛错都不改索引，避免出现"有记录没文件"或反过来
    const list = loadIndex();
    list.push(entry);
    saveIndex(list);
    res.status(201).json(entry);
  } catch (e) {
    console.error('[clipimg] 写入失败:', e.message);
    res.status(500).json({ error: '写入失败：' + e.message });
  }
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
  try {
    list.splice(i, 1);
    saveIndex(list);
  } catch (e) {
    console.error('[clipimg] 索引更新失败:', e.message);
    return res.status(500).json({ error: '索引更新失败：' + e.message });
  }
  res.json({ ok: true });
});

// express.raw 抛的错（最典型是超过 30mb 上限）默认会走 express 的 HTML 错误页，
// 前端只拿到一个状态码。统一转成 JSON，把原因带回去。
router.use((err, req, res, next) => {
  if (!err) return next();
  console.error('[clipimg] 请求处理失败:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'upload failed' });
});

export default router;
