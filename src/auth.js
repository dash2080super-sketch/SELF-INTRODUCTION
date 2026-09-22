import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';

const COOKIE_NAME = 'bb_session';

// ---------- 会话票据：HMAC 签名的无状态 token（不占内存、不落库） ----------
function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function signSession() {
  const payload = { exp: Date.now() + config.sessionDays * 86400_000 };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySession(token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export function setSessionCookie(res) {
  const maxAge = config.sessionDays * 86400_000;
  res.cookie(COOKIE_NAME, signSession(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd, // 走 HTTPS 反向代理后才开 secure
    maxAge,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// ---------- 登录失败限流（内存计数，够用且零依赖） ----------
const attempts = new Map(); // ip -> { count, resetAt }
const MAX_FAILS = 8;
const WINDOW_MS = 15 * 60_000;

function tooManyFails(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() > rec.resetAt) {
    attempts.delete(ip);
    return false;
  }
  return rec.count >= MAX_FAILS;
}

function noteFail(ip) {
  const rec = attempts.get(ip) || { count: 0, resetAt: Date.now() + WINDOW_MS };
  rec.count += 1;
  attempts.set(ip, rec);
}

// ---------- 中间件 ----------
const PUBLIC_PATHS = new Set(['/login.html', '/api/login', '/api/health', '/favicon.ico']);

export function authGuard(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (verifySession(req.cookies?.[COOKIE_NAME])) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect('/login.html');
}

const LOGIN_ERR = {
  '1': '密码错误',
  '2': '尝试次数过多，15 分钟后再试',
  '3': '请输入密码',
};

export function handleLogin(req, res) {
  const ip = req.ip || 'unknown';
  // 浏览器是「真表单提交」（x-www-form-urlencoded）：必须走 303 重定向，
  // Safari / iCloud 钥匙串靠「表单提交 + 跳转」才认得出这是一次登录并弹保存。
  // 脚本与自检（Content-Type: application/json）继续返回 JSON，
  // 别改掉 —— smoke-test 依赖 200 + {ok:true}。
  const wantsJson = req.is('json');
  const fail = (status, code) =>
    wantsJson
      ? res.status(status).json({ error: LOGIN_ERR[code] })
      : res.redirect(303, `/login.html?e=${code}`);

  if (tooManyFails(ip)) {
    return fail(429, '2');
  }
  const { password } = req.body || {};
  if (typeof password !== 'string' || !password) {
    return fail(400, '3');
  }
  const ok = bcrypt.compareSync(password, config.passwordHash);
  if (!ok) {
    noteFail(ip);
    return fail(401, '1');
  }
  attempts.delete(ip);
  setSessionCookie(res);
  return wantsJson ? res.json({ ok: true }) : res.redirect(303, '/index.html');
}

export function handleLogout(req, res) {
  clearSessionCookie(res);
  res.json({ ok: true });
}
