/**
 * 实测 finance 看板的资源开销。
 * 做法：读 /proc/<pid>/stat 的 CPU 时间（utime+stime）和 RSS，
 * 然后模拟"Vic 一直盯着看"——每 20 秒请求一次 /api/finance，持续 DURATION 秒，
 * 再读一次，算差值。
 * 这样得到的是真实增量，不是猜的。
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const DURATION = Number(process.argv[2] || 120); // 秒
const INTERVAL = Number(process.argv[3] || 20); // 秒
const COOKIE = process.env.CK || '';

function pidOf() {
  // 用 systemd 的 MainPID 最可靠，pgrep 会误抓到自己
  const out = execSync('systemctl show -p MainPID --value billboard').toString().trim();
  const pid = Number(out);
  if (!pid || !fs.existsSync(`/proc/${pid}/stat`)) {
    throw new Error(`拿不到 billboard 的 PID（MainPID=${out}）`);
  }
  return String(pid);
}

function cpuAndRss(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ');
  // utime=13, stime=14 (0-indexed 13/14), 单位 clock ticks
  const ticks = Number(stat[13]) + Number(stat[14]);
  const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
  const rssKB = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] || 0);
  return { ticks, rssKB, cpuSec: ticks / Number(execSync('getconf CLK_TCK').toString().trim()) };
}

async function api(path) {
  const r = await fetch('http://127.0.0.1:3000' + path, { headers: { Cookie: `bb_session=${COOKIE}` } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
  return r.json();
}

const pid = pidOf();
console.log(`billboard pid = ${pid}`);

const before = cpuAndRss(pid);
const s0 = await api('/api/finance/stats');
console.log(`起始: CPU ${before.cpuSec.toFixed(2)}s  RSS ${(before.rssKB / 1024).toFixed(1)}MB  上游请求 ${s0.requests}`);

console.log(`\n[阶段一] 模拟"Vic 一直盯着看"：每 ${INTERVAL}s 一次，持续 ${DURATION}s`);
let n = 0;
const t0 = Date.now();
while (Date.now() - t0 < DURATION * 1000) {
  await api('/api/finance');
  n++;
  const s = await api('/api/finance/stats');
  console.log(`  第 ${n} 次  ${Math.round((Date.now() - t0) / 1000)}s  上游累计 ${s.requests}  模式 ${s.mode}  实时档 ${s.fastAge}ms`);
  const wait = t0 + n * INTERVAL * 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

const after = cpuAndRss(pid);
const s1 = await api('/api/finance/stats');
const elapsed = (Date.now() - t0) / 1000;
const cpuUsed = after.cpuSec - before.cpuSec;
const reqs = s1.requests - s0.requests;

console.log('\n================ 阶段一结果 ================');
console.log(`观测时长      ${elapsed.toFixed(0)} 秒`);
console.log(`客户端请求    ${n} 次`);
console.log(`上游请求      ${reqs} 次  （${(reqs / (elapsed / 60)).toFixed(1)} 次/分钟，${(reqs / elapsed).toFixed(2)} 次/秒）`);
console.log(`billboard CPU ${cpuUsed.toFixed(2)} 秒  →  占单核 ${((cpuUsed / elapsed) * 100).toFixed(2)}%`);
console.log(`内存 RSS      ${(before.rssKB / 1024).toFixed(1)} → ${(after.rssKB / 1024).toFixed(1)} MB  （${((after.rssKB - before.rssKB) / 1024).toFixed(1)} MB）`);
console.log(`堆内存        ${s1.heapMB} MB   刷新轮次 ${s1.cycles - s0.cycles}   失败 ${s1.errors - s0.errors}`);
console.log('============================================');

// ---- 阶段二：停手，看服务端会不会自己降速 ----
const IDLE_WAIT = Number(process.argv[4] || 100);
console.log(`\n[阶段二] 停手 ${IDLE_WAIT}s，验证服务端是否自动进入省电模式…`);
const beforeIdle = cpuAndRss(pid);
const s2 = await api('/api/finance/stats');
await new Promise((r) => setTimeout(r, IDLE_WAIT * 1000));
const afterIdle = cpuAndRss(pid);
const s3 = await api('/api/finance/stats');

console.log('================ 阶段二结果 ================');
console.log(`无人观看 ${IDLE_WAIT} 秒后`);
console.log(`模式          ${s2.mode} → ${s3.mode}`);
console.log(`上游请求      ${s3.requests - s2.requests} 次  （空闲期几乎不该发请求）`);
console.log(`billboard CPU ${(afterIdle.cpuSec - beforeIdle.cpuSec).toFixed(2)} 秒  →  占单核 ${(((afterIdle.cpuSec - beforeIdle.cpuSec) / IDLE_WAIT) * 100).toFixed(2)}%`);
console.log(`内存 RSS      ${(beforeIdle.rssKB / 1024).toFixed(1)} → ${(afterIdle.rssKB / 1024).toFixed(1)} MB`);
console.log('============================================');

const fin = await api('/api/finance');
const fast = fin.zones.flatMap((z) => z.items).filter((i) => i.tier === 'fast');
console.log('\n实时档指标（' + fast.length + ' 个）最新读数：');
for (const it of fast) {
  const legs = Object.entries(it.legs || {}).map(([k, v]) => `${k}=${v.price}`).join('  ');
  console.log(`  ${it.name.padEnd(14)} ${legs}`);
}
