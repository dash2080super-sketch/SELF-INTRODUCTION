/**
 * ndxspx 取数器 + 真刷新。
 *
 * 数据来源：cron / 手动触发跑出的 /opt/ndxspx/latest.json。
 * 与 n225 同一个套路：**判定逻辑只在 Python 里存在一份**，Node 不重实现，避免漂移。
 *
 * 和 n225 的差别：
 *   - 这里没有「早间/午后」时段概念（美股在北京时间夜里，北京时间早上跑一次就够），
 *     所以刷新不传 --slot。
 *   - daily_decide.py 要拉 5 个源（财政部 nominal + real、CBOE、CNN、Yahoo×5），
 *     实测 25~35 秒，RUN_TIMEOUT 给到 120s。
 *
 * 目录：process.env.NDXSPX_DIR，默认 /opt/ndxspx；
 * 也可以用 NDXSPX_JSON 指定完整文件路径（本机调试用）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DIR = process.env.NDXSPX_DIR || '/opt/ndxspx';
const FILE = process.env.NDXSPX_JSON || path.join(DIR, 'latest.json');
const HISTORY = path.join(path.dirname(FILE), 'history.jsonl');

const PY = process.env.NDXSPX_PY || '/usr/bin/python3';
const SCRIPT = process.env.NDXSPX_SCRIPT || path.join(DIR, 'daily_decide.py');

const TTL = 60 * 1000;          // 读盘缓存
const HISTORY_LIMIT = 60;       // 最近 60 条判定
const RUN_TIMEOUT = 120 * 1000; // 5 个上游，最坏情况给足 2 分钟

let cache = null;   // { at, payload }
let running = null; // 并发锁：同一时刻只允许一个 Python 在跑

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readHistory() {
  try {
    if (!fs.existsSync(HISTORY)) return [];
    const out = [];
    for (const l of fs.readFileSync(HISTORY, 'utf8').split('\n').filter((x) => x.trim()).slice(-HISTORY_LIMIT)) {
      try {
        out.push(JSON.parse(l));
      } catch {
        /* 单条坏了跳过，别让整块历史挂掉 */
      }
    }
    return out.reverse(); // 新的在前
  } catch {
    return [];
  }
}

function readPayload() {
  try {
    fs.statSync(FILE);
  } catch {
    return { payload: { error: `读不到 ${FILE}。先确认 cron 跑过 daily_decide.py（${DIR}/run.log 有记录）。` } };
  }
  try {
    return { payload: { ...readJSON(FILE), history: readHistory(), _file: FILE } };
  } catch (e) {
    return { payload: { error: `latest.json 解析失败：${e.message}` } };
  }
}

/** 取最新判定（读盘，不跑 Python）。force=true 忽略缓存。 */
export function getNdxspx(force = false) {
  const now = Date.now();
  if (!force && cache && now - cache.at < TTL) return cache.payload;
  const { payload } = readPayload();
  cache = { at: now, payload };
  return payload;
}

/**
 * 真刷新：起子进程跑一次 daily_decide.py，等它写完 latest.json 再读回来。
 * - 并发保护：同时只有一个 Python，后来的请求复用同一个 Promise。
 * - 超时保护：网络挂了就杀掉，返回上一次数据 + 明确提示，不让前端一直转圈。
 */
export function refreshNdxspx() {
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
        ...getNdxspx(true),
        _refresh: { ok: false, msg: `找不到 ${SCRIPT}，无法重跑判定` },
      });
    }

    let err = '';
    const child = spawn(PY, [SCRIPT, '--quiet'], {
      cwd: path.dirname(SCRIPT),
      env: { ...process.env, NDXSPX_DIR: DIR },
    });

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      finish({
        ...getNdxspx(true),
        _refresh: { ok: false, msg: `重跑超时（>${RUN_TIMEOUT / 1000}s），上面仍是旧数据` },
      });
    }, RUN_TIMEOUT);

    child.stdout.on('data', () => {});
    child.stderr.on('data', (b) => (err += b.toString('utf8')));

    child.on('error', (e) => {
      clearTimeout(timer);
      finish({ ...getNdxspx(true), _refresh: { ok: false, msg: `无法启动 ${PY}：${e.message}` } });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const fresh = getNdxspx(true);
      if (code === 0) {
        finish({ ...fresh, _refresh: { ok: true, msg: '已重跑判定', at: new Date().toISOString() } });
      } else {
        const tail = err.trim().split('\n').filter(Boolean).pop() || '';
        finish({
          ...fresh,
          _refresh: { ok: false, msg: `daily_decide.py 退出码 ${code}${tail ? '：' + tail : ''}` },
        });
      }
    });
  });

  return running;
}
