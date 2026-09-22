/**
 * n225（N225策略）取数器。
 *
 * 不抓上游 —— 直接读 cron 落下的 /opt/nikkei/latest.json。
 * 理由：判定逻辑（溢价闸门 / 金字塔档位 / score）写在 Python 里，
 * Node 侧再实现一遍必然两边漂移。这里只负责读文件 + 按 mtime 缓存。
 *
 * 目录：process.env.NIKKEI_DIR，默认 /opt/nikkei；
 * 也可以直接用 NIKKEI_JSON 指定完整文件路径（本机调试用）。
 */
import fs from 'node:fs';
import path from 'node:path';

const FILE =
  process.env.NIKKEI_JSON ||
  path.join(process.env.NIKKEI_DIR || '/opt/nikkei', 'latest.json');
const HISTORY = path.join(path.dirname(FILE), 'history.jsonl');

const TTL = 60 * 1000; // 文件一天才变两次，1 分钟缓存足够
const HISTORY_LIMIT = 30;

let cache = null; // { at, mtimeMs, payload }

function readJSON(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function readHistory() {
  try {
    if (!fs.existsSync(HISTORY)) return [];
    const lines = fs
      .readFileSync(HISTORY, 'utf8')
      .split('\n')
      .filter((x) => x.trim());
    const out = [];
    for (const l of lines.slice(-HISTORY_LIMIT)) {
      try {
        out.push(JSON.parse(l));
      } catch {
        /* 单条坏了就跳过，别让整块历史挂掉 */
      }
    }
    return out.reverse(); // 新的在前
  } catch {
    return [];
  }
}

/**
 * 取最新判定。force=true 时忽略缓存重新读盘。
 * 文件不存在 / 解析失败都返回 { error }，由前端显示成提示而不是空白。
 */
export function getN225(force = false) {
  const now = Date.now();
  if (!force && cache && now - cache.at < TTL) return cache.payload;

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(FILE).mtimeMs;
  } catch {
    const payload = {
      error: `读不到 ${FILE}。确认 cron 跑过 daily_advice.py（/opt/nikkei/run.log 里有记录）。`,
    };
    cache = { at: now, mtimeMs: 0, payload };
    return payload;
  }

  // 文件没变就直接复用上一次的解析结果，省一次 JSON.parse
  if (!force && cache && cache.mtimeMs === mtimeMs) {
    cache.at = now;
    return cache.payload;
  }

  try {
    const payload = { ...readJSON(FILE), history: readHistory(), _file: FILE };
    cache = { at: now, mtimeMs, payload };
    return payload;
  } catch (e) {
    const payload = { error: `latest.json 解析失败：${e.message}` };
    cache = { at: now, mtimeMs, payload };
    return payload;
  }
}

export const stats = { file: FILE, cachedAt: null };
