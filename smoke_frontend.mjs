/**
 * 前端模块冒烟：mock 一个最小的 window.Billboard / document，然后真实 import
 * public/js/modules/ndxspx.js，确认：
 *   1) 文件能被浏览器当 ES module 解析（顶层无语法/引用错误）
 *   2) 它真的注册了 'ndxspx'
 *   3) 渲染出的 HTML 不含 "undefined" / "NaN"
 *   4) L0 月度开关在不同场景下行为正确 —— 重点是「月度开关只封 L0，不封触发层」
 * 不渲染真实页面（无 jsdom），只验证逻辑分支不炸。
 *
 * 用法：node smoke_frontend.mjs
 *   环境变量：NSPX_MOD（模块路径）、NSPX_JSON（数据路径）
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.NSPX_ROOT || '/opt/billboard';
const MOD = process.env.NSPX_MOD || path.join(ROOT, 'public/js/modules/ndxspx.js');
const JSON_PATH = process.env.NSPX_JSON || '/opt/ndxspx/latest.json';

const store = { kv: {} };   // 模拟站点 /api/kv

let registered = null;
globalThis.window = {
  Billboard: {
    esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    toast: (m) => { store.toast = m; },
    register(id, impl) { registered = { id, impl }; },
    kvGet: async (k) => ({ key: k, value: store.kv[k] ?? '', updatedAt: null }),
    kvSet: async (k, v) => { store.kv[k] = String(v); return { ok: true, key: k, value: String(v) }; },
  },
};
globalThis.document = { addEventListener() {}, querySelector() { return null; }, hidden: false };
globalThis.location = { href: '' };
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};

let DATA = null;
globalThis.fetch = async () => ({ status: 200, json: async () => DATA });

await import(pathToFileURL(MOD).href);

let fails = 0;
const ok = (cond, msg) => { console.log(`   ${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };

console.log('1) 注册 id =', registered && registered.id);
if (!registered || registered.id !== 'ndxspx') { console.log('   ✗ 没有正确注册'); process.exit(1); }
console.log('   ✓ 注册成功，mount =', typeof registered.impl.mount);

/* ---- 北京时间 YYYY-MM ---- */
const monthKey = () => {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
};

/* ---- 假 panel：抓渲染出的 HTML ---- */
function makePanel() {
  const state = { body: '', foot: '', note: '' };
  const panel = {
    innerHTML: '',
    classList: { contains: () => true },
    querySelector(sel) {
      if (sel === '#nspx-body') return {
        set innerHTML(v) { state.body = v; }, get innerHTML() { return state.body; },
        parentNode: { insertBefore() {} },
      };
      if (sel === '#nspx-foot') return { set innerHTML(v) { state.foot = v; }, textContent: '' };
      if (sel === '#nspx-refresh') return { set onclick(v) {}, disabled: false, textContent: '' };
      if (sel === '#nspx-note') return { set innerHTML(v) { state.note = v; }, textContent: '' };
      if (sel === '#nspx-l0done') return { set onchange(v) { state.onchange = v; }, checked: false, disabled: false };
      return null;
    },
  };
  return { panel, state };
}

async function mountWith(data, l0done) {
  DATA = data;
  store.kv['ndxspx.l0.' + monthKey()] = l0done ? '1' : '0';
  const { panel, state } = makePanel();
  await registered.impl.mount({ panel });
  return state.body + state.note;
}

/* ---- 场景：真数据 + 合成的触发层数据 ---- */
const real = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

function withTier(leg, tier, amount) {
  const d = JSON.parse(JSON.stringify(real));
  for (const L of d.decision.legs) {
    if (L.leg === leg) Object.assign(L, { tier, can_add: true, amount_pct: amount, tranches: 2, per_tranche_pct: +(amount / 2).toFixed(3) });
  }
  d.decision.action = `可以投 ${tier}`;
  return d;
}

console.log('\n2) [真数据 · 未投] L0 月度');
let html = await mountWith(real, false);
const bad1 = ['undefined', 'NaN', '[object Object]'].filter((t) => html.includes(t));
ok(html.length > 500, `渲染 ${html.length} bytes`);
ok(!bad1.length, `无占位符${bad1.length ? ' → ' + bad1 : ''}`);
ok(html.includes('本月可投'), '标题写「本月可投」');
ok(html.includes('月度，不是每天'), '标注「月度，不是每天」');
ok(html.includes('nspx-l0'), '开关块存在');
ok(!html.includes('本月额度已用'), '未显示「已用」');

console.log('\n3) [真数据 · 已投] L0 月度');
html = await mountWith(real, true);
const bad2 = ['undefined', 'NaN', '[object Object]'].filter((t) => html.includes(t));
ok(!bad2.length, `无占位符${bad2.length ? ' → ' + bad2 : ''}`);
ok(html.includes('本月额度已用'), '判定改「本月额度已用」');
ok(html.includes('本月剩余'), '金额栏改「本月剩余」');
ok(html.includes('本月已用'), '腿徽章改「本月已用」');
ok(/nspx-vsize used|nspx-legamt used/.test(html), '金额划掉');
ok(/nspx-vsize[^>]*>0\.000<span>/.test(html), '合计归零');

console.log('\n4) [合成 · SPY 触发 L1 · 未投] 触发层与月度并存');
html = await mountWith(withTier('SPY', 'L1', 0.992), false);
const bad3 = ['undefined', 'NaN', '[object Object]'].filter((t) => html.includes(t));
ok(!bad3.length, `无占位符${bad3.length ? ' → ' + bad3 : ''}`);
ok(html.includes('本次可投'), '标题回到「本次可投」（触发层在）');
ok(!html.includes('本月额度已用'), '未投时当然不显示「已用」');

console.log('\n5) [合成 · SPY 触发 L1 · 已投] 关键：月度开关不得封住触发层');
html = await mountWith(withTier('SPY', 'L1', 0.992), true);
const bad4 = ['undefined', 'NaN', '[object Object]'].filter((t) => html.includes(t));
ok(!bad4.length, `无占位符${bad4.length ? ' → ' + bad4 : ''}`);
ok(!html.includes('本月额度已用'), '整卡不转「已用」（触发层还在）');
ok(html.includes('可以投 L1'), '仍显示「可以投 L1」');
ok(/nspx-vsize[^>]*>0\.9/.test(html), '触发层金额照旧显示（0.9xx%）');

console.log('\n6) 关键 class：');
for (const k of ['nspx-verdict', 'nspx-leg', 'nspx-axis', 'nspx-sec', 'nspx-table', 'nspx-l0'])
  ok(html.includes(k), k);

console.log('\n结论：', fails ? `${fails} 项失败` : 'OK（含「月度开关不封触发层」）');
process.exit(fails ? 1 : 0);
