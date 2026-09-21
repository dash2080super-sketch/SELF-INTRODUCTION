#!/usr/bin/env node
/* 生成 .env：写入 bcrypt 密码散列 + 随机会话密钥。
   用法：
     npm run set-password            # 交互式输入（不回显，最安全）
     npm run set-password -- 你的密码  # 非交互（会留在 shell 历史里，仅在确认无妨时用）
*/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, '.env');

function hiddenPrompt(question) {
  return new Promise((resolve) => {
    let out = '';
    process.stdout.write(question);
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.setRawMode) process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = (chunk) => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(out);
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') {
          out = out.slice(0, -1);
          process.stdout.write('\b \b');
        } else if (ch >= ' ') {
          out += ch;
          process.stdout.write('*');
        }
      }
    };
    function cleanup() {
      process.stdin.removeListener('data', onData);
      if (process.stdin.setRawMode && wasRaw === false) process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    process.stdin.on('data', onData);
  });
}

async function main() {
  let pw = process.argv[2];
  if (!pw) {
    if (!process.stdin.isTTY) {
      console.error('当前不是交互终端，请直接传参：npm run set-password -- 你的密码');
      process.exit(1);
    }
    pw = await hiddenPrompt('设置登录密码: ');
    if (!pw) {
      console.error('密码不能为空');
      process.exit(1);
    }
    const pw2 = await hiddenPrompt('再输一次: ');
    if (pw !== pw2) {
      console.error('两次不一致');
      process.exit(1);
    }
  }
  if (pw.length < 6) console.warn('⚠️  密码偏短，建议 10 位以上。');

  const hash = bcrypt.hashSync(pw, 10);

  let existing = '';
  if (fs.existsSync(ENV_PATH)) existing = fs.readFileSync(ENV_PATH, 'utf8');

  // 已有 SESSION_SECRET 就沿用，免得改个密码把所有已登录设备都踢下线
  const prevSecret = /^SESSION_SECRET=(\S+)/m.exec(existing);
  const secret = prevSecret ? prevSecret[1] : crypto.randomBytes(32).toString('base64url');

  const set = (text, key, val) => {
    const re = new RegExp(`^${key}=.*$`, 'm');
    return re.test(text) ? text.replace(re, `${key}=${val}`) : `${text.trimEnd()}\n${key}=${val}\n`;
  };
  let out = existing || 'PORT=3000\nHOST=127.0.0.1\nNODE_ENV=production\nSESSION_DAYS=30\n';
  out = set(out, 'PASSWORD_HASH', hash);
  out = set(out, 'SESSION_SECRET', secret);

  fs.writeFileSync(ENV_PATH, out, { mode: 0o600 });
  console.log(`\n✅ 已写入 ${ENV_PATH}`);
  console.log('   现在可以启动： npm start');
}

main();
