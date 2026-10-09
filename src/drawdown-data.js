/**
 * drawdown（回撤与连跌）取数器。
 *
 * 只做一件事：把 7 大股指的日线收盘价抓回来、缓存住，原样交给前端。
 * 所有指标（回撤 / 连涨连跌 / 区间涨跌）都在前端按所选窗口现算，
 * 这样切「10 日 / 1 个月 / 3 个月」不用再打上游。
 *
 * 为什么缓存这么保守：这是日线数据，一天变一次。TTL 30 分钟足够，
 * 没人看面板时一个上游请求都不发（刷新只在客户端请求时触发）。
 *
 * 两级兜底：
 *   1) 内存缓存 —— 上游抖一下，用上一次的结果，面板不闪空白；
 *   2) 磁盘缓存 —— data/drawdown-cache.json，重启后直接读盘，
 *      避免每次重启都去打上游（小机器上也省事）。
 *
 * 网络：优先直连；如果环境里配了 HTTPS_PROXY / HTTP_PROXY 就走 CONNECT 隧道。
 * 本机（Windows）必须走代理，VPS 上一般直连即可，所以两条路都留着。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { ROOT } from './config.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 展示名 / 中文名 / 地区 / 备注（TOPIX 用 ETF 代理，见下） */
export const INDEXES = [
  { symbol: '^GDAXI', name: 'DAX 30', cn: '德国 DAX', region: '欧洲' },
  { symbol: '^FCHI', name: 'CAC 40', cn: '法国 CAC 40', region: '欧洲' },
  { symbol: '^FTSE', name: 'FTSE 100', cn: '英国富时 100', region: '欧洲' },
  { symbol: '^NDX', name: 'NASDAQ 100', cn: '纳斯达克 100', region: '美国' },
  { symbol: '^GSPC', name: 'S&P 500', cn: '标普 500', region: '美国' },
  { symbol: '^N225', name: 'NIKKEI 225', cn: '日经 225', region: '亚太' },
  // Yahoo 没有 TOPIX 指数代码（^TOPX / ^TPX 都是 404），用东证 ETF 代理：
  // 点位不等于指数本身，但涨跌幅、回撤、连涨跌结论一致。
  {
    symbol: '1306.T',
    name: 'TOPIX',
    cn: '东证指数',
    region: '亚太',
    note: 'Yahoo 无 TOPIX 指数代码，用 1306.T（NEXT FUNDS TOPIX ETF）代理，涨跌幅与连涨跌结论一致',
  },
];

// 12 个月 ≈ 250 个交易日。原来是 3 个月，但「距一年高点回撤」需要满 250 日窗口，
// 3 个月的日线算不出一年高点，只能拿上游的 fiftyTwoWeekHigh 顶上（盘中口径，虚高）。
const RANGE_MONTHS = 12;
const TTL = 30 * 60 * 1000; // 日线数据，半小时刷一次足够
const DISK_MAX_AGE = 12 * 60 * 60 * 1000; // 磁盘缓存超过 12 小时就不再当新鲜货
const CACHE_FILE = path.join(ROOT, 'data', 'drawdown-cache.json');
const TIMEOUT = 15_000;

let cache = null; // { at, payload }
let inFlight = null; // 同一时刻的多个客户端请求共用一个 Promise
let lastClientAt = 0;

export const stats = { cycles: 0, requests: 0, errors: 0, lastRefreshAt: null, lastMs: 0 };

/* ---------------- 网络：直连 / 代理隧道 ---------------- */

/** 代理地址：DRAWDOWN_PROXY 优先（本机专属配置），其次是通用的 HTTPS_PROXY / HTTP_PROXY */
function proxyUrl() {
  return (
    process.env.DRAWDOWN_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    ''
  );
}

/** 通过 HTTP 代理建立 CONNECT 隧道，拿到一条通往目标主机的裸 socket */
function connectTunnel(proxy, host, port) {
  return new Promise((resolve, reject) => {
    const p = new URL(proxy);
    const req = http.request({
      host: p.hostname,
      port: Number(p.port) || 80,
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers: { Host: `${host}:${port}` },
    });
    req.setTimeout(TIMEOUT, () => req.destroy(new Error('代理连接超时')));
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`代理 CONNECT 失败 (${res.statusCode})`));
        return;
      }
      resolve(socket);
    });
    req.once('error', reject);
    req.end();
  });
}

/** 把 chunked 编码还原成完整 Buffer */
function dechunk(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const nl = buf.indexOf('\r\n', i);
    if (nl < 0) break;
    const size = parseInt(buf.slice(i, nl).toString('latin1').trim(), 16);
    if (!Number.isFinite(size) || size === 0) break;
    out.push(buf.subarray(nl + 2, nl + 2 + size));
    i = nl + 2 + size + 2;
  }
  return Buffer.concat(out);
}

/** 解析 HTTP/1.1 响应（只在代理隧道这条路上需要手写） */
function parseResponse(rawBuf) {
  const sep = rawBuf.indexOf('\r\n\r\n');
  if (sep < 0) throw new Error('响应格式异常');
  const head = rawBuf.subarray(0, sep).toString('latin1');
  const lines = head.split('\r\n');
  const status = parseInt(lines[0].split(' ')[1], 10);
  const headers = {};
  for (const l of lines.slice(1)) {
    const i = l.indexOf(':');
    if (i > 0) headers[l.slice(0, i).toLowerCase().trim()] = l.slice(i + 1).trim();
  }
  let body = rawBuf.subarray(sep + 4);
  if ((headers['transfer-encoding'] || '').includes('chunked')) body = dechunk(body);
  if ((headers['content-encoding'] || '').includes('gzip')) {
    try {
      body = zlib.gunzipSync(body);
    } catch {
      /* 解压失败就当纯文本处理 */
    }
  }
  return { status, body: body.toString('utf8') };
}

/** GET 一个 https 地址，返回响应体文本。没配代理就直连。 */
function getDirect(urlStr) {
  const u = new URL(urlStr);
  const headers = { Host: u.hostname, 'User-Agent': UA, Accept: 'application/json,*/*', 'Accept-Encoding': 'gzip' };
  return new Promise((resolve, reject) => {
    const req = https.request(
      { method: 'GET', host: u.hostname, port: Number(u.port) || 443, path: u.pathname + u.search, headers, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let buf = Buffer.concat(chunks);
          if ((res.headers['content-encoding'] || '').includes('gzip')) {
            try {
              buf = zlib.gunzipSync(buf);
            } catch {}
          }
          if (res.statusCode !== 200) return reject(new Error(`上游 ${res.statusCode}`));
          resolve(buf.toString('utf8'));
        });
        res.on('error', reject);
      }
    );
    req.setTimeout(TIMEOUT, () => req.destroy(new Error('请求超时')));
    req.once('error', reject);
    req.end();
  });
}

/** GET 一个 https 地址：配了代理就走隧道，隧道不通再退回直连（代理挂了也不至于整个面板瞎） */
async function httpsGet(urlStr) {
  const px = proxyUrl();
  if (px) {
    try {
      return await getViaProxy(urlStr, px);
    } catch (e) {
      console.warn(`[drawdown] 代理(${px})取数失败，改直连: ${e.message}`);
    }
  }
  return getDirect(urlStr);
}

async function getViaProxy(urlStr, proxy) {
  const u = new URL(urlStr);
  const headers = { Host: u.hostname, 'User-Agent': UA, Accept: 'application/json,*/*', 'Accept-Encoding': 'gzip' };

  const raw = await connectTunnel(proxy, u.hostname, Number(u.port) || 443);
  const sock = tls.connect({ socket: raw, servername: u.hostname }, () => {});
  await new Promise((resolve, reject) => {
    sock.once('secureConnect', resolve);
    sock.once('error', reject);
    setTimeout(() => reject(new Error('TLS 握手超时')), TIMEOUT).unref?.();
  });
  return new Promise((resolve, reject) => {
    const chunks = [];
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('读取超时'));
    }, TIMEOUT);
    sock.on('data', (c) => chunks.push(c));
    sock.on('end', () => {
      clearTimeout(timer);
      try {
        const r = parseResponse(Buffer.concat(chunks));
        if (r.status !== 200) return reject(new Error(`上游 ${r.status}`));
        resolve(r.body);
      } catch (e) {
        reject(e);
      }
    });
    sock.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    sock.write(
      `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
        Object.entries(headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n') +
        `\r\nConnection: close\r\n\r\n`
    );
  });
}

/* ---------------- 抓一个指数 ---------------- */

async function fetchOne(def) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(def.symbol)}` +
    `?range=${RANGE_MONTHS}mo&interval=1d&includePrePost=false`;
  const txt = await httpsGet(url);
  const j = JSON.parse(txt);
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error('返回为空');
  const closes = res.indicators?.quote?.[0]?.close || [];
  const rows = [];
  res.timestamp.forEach((t, i) => {
    if (closes[i] == null) return;
    // Yahoo 给的是当天交易所时区的时间戳，统一按 UTC 取日期就够用
    const d = new Date(t * 1000);
    rows.push({
      date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
      close: Math.round(closes[i] * 100) / 100,
    });
  });
  if (!rows.length) throw new Error('没有收盘价');

  // 回撤口径统一：用最近 250 个交易日的**收盘**最高价。
  // 为什么不用 meta.fiftyTwoWeekHigh：那是 52 周**盘中**最高，比收盘高系统性偏高一截
  // （日经上实测差 465 点，回撤虚高约 60bp）。而加仓档位是收盘后决策、次日开盘执行，
  // 拿盘中高价算回撤会让人误以为跌得比实际更深，在档位边界上过早跳进更激进的那一档。
  // /api/n225 一直是 250 日收盘口径，这里对齐它，全站一个真相。
  // high52 保留但只作参考，前端不拿它算回撤。
  let peak250 = null;
  let peak250Date = null;
  for (const r of rows.slice(-250)) {
    if (peak250 == null || r.close > peak250) {
      peak250 = r.close;
      peak250Date = r.date;
    }
  }

  // Yahoo 的日线数组偶尔会落后一天。实测 2026-10-01：^N225 的 regularMarketPrice 已经是当日
  // 收盘 68,956.72，但日线数组最后一根还停在 09-30 的 66,753.72。只按数组取"当前价"会把回撤
  // 算成 -7.76%（实际 -4.71%），差 3 个百分点——这个量级会直接跨过加仓档位的边界
  // （-10% / -6% / -3%），必须补上。
  // 只补**分子**（当前价）：peak250 仍然只吃收盘序列，盘中价不许污染分母。
  const lastRow = rows[rows.length - 1];
  const isoDate = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const mt = res.meta?.regularMarketTime ? new Date(res.meta.regularMarketTime * 1000) : null;
  const mtDate = mt ? isoDate(mt) : null;
  const mkt = res.meta?.regularMarketPrice;
  const newer = mtDate != null && mkt != null && Number.isFinite(mkt) && mtDate > lastRow.date;

  return {
    ...def,
    currency: res.meta?.currency || '',
    high52: res.meta?.fiftyTwoWeekHigh ?? null, // 盘中口径，仅参考，不用于回撤
    peak250,
    peak250Date,
    rows,
    // 前端算回撤一律用这个当"当前价"，别再拿 rows 最后一根（它可能是一天前）
    lastPrice: newer ? Math.round(mkt * 100) / 100 : lastRow.close,
    lastDate: newer ? mtDate : lastRow.date,
    lastIsNewer: newer,
    // 日线数组缺当日那根时，日涨跌也得自己算（基准就是最后一根收盘）
    lastChgPct: newer ? Math.round((mkt / lastRow.close - 1) * 10000) / 100 : null,
  };
}

/* ---------------- 磁盘缓存 ---------------- */

function readDisk() {
  try {
    const st = fs.statSync(CACHE_FILE);
    if (Date.now() - st.mtimeMs > DISK_MAX_AGE) return null;
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (!j?.indexes?.length) return null;
    return j;
  } catch {
    return null;
  }
}

function writeDisk(payload) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(payload));
  } catch (e) {
    console.warn('[drawdown] 磁盘缓存写入失败:', e.message);
  }
}

/* ---------------- 对外 ---------------- */

export function invalidate() {
  cache = null;
}

/** 供 API 调用：拿一份（可能来自缓存的）快照 */
export async function getDrawdown(force = false) {
  lastClientAt = Date.now();
  if (!force && cache && Date.now() - cache.at < TTL) return { ...cache.payload, cached: true };

  if (inFlight) return inFlight;

  inFlight = (async () => {
    const t0 = Date.now();
    const prevRows = new Map((cache?.payload?.indexes || readDisk()?.indexes || []).map((i) => [i.symbol, i]));
    const indexes = [];
    const errors = [];

    // 并发 3 个，别把小机器和上游都压着
    const queue = INDEXES.slice();
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const def = queue.shift();
        try {
          stats.requests++;
          indexes.push(await fetchOne(def));
        } catch (e) {
          stats.errors++;
          const old = prevRows.get(def.symbol);
          if (old) {
            indexes.push({ ...old, stale: true }); // 抓失败就用旧值，面板不空白
            errors.push(`${def.name}: ${e.message}（用旧值）`);
          } else {
            errors.push(`${def.name}: ${e.message}`);
          }
        }
      }
    });
    await Promise.all(workers);

    if (!indexes.length) throw new Error('全部指数都取不到：' + errors.join('；'));

    // 按 INDEXES 的顺序输出，避免并发打乱
    const order = new Map(INDEXES.map((d, i) => [d.symbol, i]));
    indexes.sort((a, b) => (order.get(a.symbol) ?? 99) - (order.get(b.symbol) ?? 99));

    const payload = {
      updated: new Date().toISOString().slice(0, 16).replace('T', ' '),
      indexes,
      errors,
      cached: false,
    };
    cache = { at: Date.now(), payload };
    writeDisk(payload);
    stats.cycles++;
    stats.lastRefreshAt = payload.updated;
    stats.lastMs = Date.now() - t0;
    return payload;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
