/**
 * n225（N225策略）取数器 + 真刷新。
 *
 * 数据来源：cron / 手动触发跑出的 /opt/nikkei/latest.json。
 * 判定逻辑（溢价闸门 / 金字塔档位 / score）只在 Python 里存在一份，
 * Node 侧不重实现，避免两边漂移。
 *
 * 【2026-09-23 修订】新增 refreshN225()：真刷新。
 *   旧版 `?refresh=1` 只是「忽略内存缓存重读磁盘」，Python 不跑文件就不变，
 *   点刷新等于什么都没发生 —— Vic 7~8 点看 SOX/NVDA 不更新就是这个原因。
 *   现在改为：请求 → 起子进程跑 daily_advice.py → 等它落盘 → 读新文件返回。
 *
 * 目录：process.env.NIKKEI_DIR，默认 /opt/nikkei；
 * 也可以用 NIKKEI_JSON 指定完整文件路径（本机调试用）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DIR = process.env.NIKKEI_DIR || '/opt/nikkei';
const FILE = process.env.NIKKEI_JSON || path.join(DIR, 'latest.json');
const HISTORY = path.join(path.dirname(FILE), 'history.jsonl');

const PY = process.env.NIKKEI_PY || '/usr/bin/python3';
const SCRIPT = process.env.NIKKEI_SCRIPT || path.join(DIR, 'daily_advice.py');

const TTL = 60 * 1000;        // 读盘缓存：别把 JSON.parse 打成热点
const HISTORY_LIMIT = 30;
const RUN_TIMEOUT = 90 * 1000; // Python 要抓 Yahoo + 东财，最坏情况给足 90s

let cache = null;   // { at, mtimeMs, payload }
let running = null; // 并发锁：同一时刻只允许一个 Python 在跑，返回同一个 Promise

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
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

function readPayload() {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(FILE).mtimeMs;
  } catch {
    return { mtimeMs: 0, payload: { error: `读不到 ${FILE}。确认 cron 跑过 daily_advice.py（${DIR}/run.log 里有记录）。` } };
  }
  try {
    return { mtimeMs, payload: { ...readJSON(FILE), history: readHistory(), _file: FILE } };
  } catch (e) {
    return { mtimeMs, payload: { error: `latest.json 解析失败：${e.message}` } };
  }
}

/** 取最新判定（读盘，不跑 Python）。force=true 忽略缓存。 */
export function getN225(force = false) {
  const now = Date.now();
  if (!force && cache && now - cache.at < TTL) return cache.payload;

  const { mtimeMs, payload } = readPayload();
  cache = { at: now, mtimeMs, payload };
  return payload;
}

/**
 * 真刷新：跑一次 daily_advice.py，等它写完 latest.json 再读回来。
 *
 * - 并发保护：同一时刻只跑一个，后来的请求直接复用正在跑的那个 Promise。
 * - 超时保护：Python 跑不完（网络挂了）就杀掉，返回上一次数据 + 明确提示，
 *   不能让前端一直转圈。
 * - 时段标记：按北京时间自动推断 am/pm（Python 侧也会自己推断，这里显式传以保持一致）。
 */
export function refreshN225() {
  if (running) return running;

  running = new Promise((resolve) => {
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      running = null;
      resolve(payload);
    };

    if (!fs.existsSync(SCRIPT)) {
      return finish({
        ...getN225(true),
        _refresh: { ok: false, msg: `找不到 ${SCRIPT}，无法重跑判定` },
      });
    }

    // 按北京时间推断时段
    const cnHour = Number(
      new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(11, 13)
    );
    const slot = cnHour < 12 ? 'am' : cnHour < 18 ? 'pm' : 'manual';

    let out = '';
    let err = '';
    const child = spawn(PY, [SCRIPT, '--json', '--slot', slot, '--quiet'], {
      cwd: path.dirname(SCRIPT),
      env: { ...process.env, NIKKEI_OUT: DIR },
    });

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      const prev = getN225(true);
      finish({
        ...prev,
        _refresh: { ok: false, msg: `重跑超时（>${RUN_TIMEOUT / 1000}s），上面仍是旧数据` },
      });
    }, RUN_TIMEOUT);

    child.stdout.on('data', (b) => (out += b.toString('utf8')));
    child.stderr.on('data', (b) => (err += b.toString('utf8')));

    child.on('error', (e) => {
      clearTimeout(timer);
      const prev = getN225(true);
      finish({ ...prev, _refresh: { ok: false, msg: `无法启动 ${PY}：${e.message}` } });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const fresh = getN225(true); // 忽略缓存，强制重读刚写下的文件
      if (code === 0) {
        finish({
          ...fresh,
          _refresh: { ok: true, msg: `已重跑判定（${slot}）`, at: new Date().toISOString() },
        });
      } else {
        finish({
          ...fresh,
          _refresh: {
            ok: false,
            msg: `daily_advice.py 退出码 ${code}${err ? '：' + err.trim().split('\n').pop() : ''}`,
          },
        });
      }
    });
  });

  return running;
}

export const stats = { file: FILE, script: SCRIPT, dir: DIR, cachedAt: null };
