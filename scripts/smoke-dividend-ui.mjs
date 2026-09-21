/**
 * 前端渲染冒烟测试。
 *
 * 为什么要这个：前端模块是模块私有的纯函数 + DOM 操作，没有浏览器就跑不到。
 * 这里用一套「刚够用」的迷你 DOM 把 dividend 面板的 mount + render 真跑一遍，
 * 目的是抓出模板里访问了不存在的字段、引用了不存在的元素这类错误 ——
 * 这类错在浏览器里只会表现为「标签点开是空白」，很难从日志里发现。
 *
 * 用法：node scripts/smoke-dividend-ui.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../src/dividend-data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- 迷你 DOM ---------- */
class FakeEl {
  constructor(tag = 'div') {
    this.tagName = tag;
    this._html = '';
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.value = '';
    this.classList = {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    };
  }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  /** 从已写入的 HTML 里粗略判断某个 id/class 是否存在 —— 够用来验证「引用的元素确实渲染出来了」 */
  _has(sel) {
    if (sel.startsWith('#')) return this._html.includes(`id="${sel.slice(1)}"`);
    if (sel.startsWith('.')) return this._html.includes(sel.slice(1));
    return this._html.includes(sel);
  }
  querySelector(sel) { return this._has(sel) ? new FakeEl() : null; }
  querySelectorAll(sel) { return this._has(sel) ? [new FakeEl()] : []; }
  appendChild(c) { return c; }
  addEventListener() {}
  remove() {}
  focus() {}
  closest() { return null; }
}
const doc = {
  createElement: (t) => new FakeEl(t),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener: () => {},
};

/* ---------- 迷你 window / 网络 ---------- */
let registered = null;
const ESC = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const realFetch = globalThis.fetch;
let payload = null;

globalThis.window = {
  Billboard: {
    esc: ESC,
    fmtTime: (s) => String(s || ''),
    toast: () => {},
    api: {
      kvGet: async () => ({ value: '' }),
      kvSet: async () => ({}),
      list: async () => ({ items: [] }),
    },
    register(id, impl) {
      registered = { id, impl };
    },
  },
};
globalThis.document = doc;
globalThis.location = { href: '' };
globalThis.confirm = () => false;
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};

/* ---------- 造真实数据 ----------
   ⚠️ 必须放在 stub fetch 之前：数据引擎自己也要用全局 fetch，
      提前 stub 会让它拿不到真实行情（报 HTTP 404）。 */
console.log('先拉一份真实数据当输入…');
const items = [];
for (const [code, meta] of [
  ['600036', { name: '招商银行', tag: '银行', note: '测试备注' }],
  ['601088', { name: '中国神华', tag: '煤炭' }],
]) {
  const it = await evaluate(code, meta);
  it.id = items.length + 1;
  it.userTag = meta.tag;
  it.userNote = meta.note || '';
  items.push(it);
}
payload = {
  strategy: {
    anchorMultiple: 3,
    gridLevels: [3.0, 3.3, 3.6, 3.9, 4.2, 4.5],
    technical: { inPct: 3, nearPct: 5, weekMonthInPct: 5, weekMonthNearPct: 8, bollPeriod: 20, bollStd: 2 },
    quality: { minDividendYears: 5, minMcapYi: 100, requirePositivePE: true, dividendDecayFloor: 0.6 },
    valuationNearPct: 8,
  },
  anchor: items[0].anchor,
  notes: (await import('../src/dividend-catalog.js')).NOTES,
  items,
  counts: { near: 1, wait: 1 },
  meta: { mode: 'on-demand', cycles: 1, requests: 18, errors: 0, cacheHits: 4, lastCycleMs: 6043, watched: 2 },
};

/* 数据拿完了，现在再 stub fetch，只服务前端那次 /api/dividend */
globalThis.fetch = async (url) => {
  if (String(url).startsWith('/api/dividend')) {
    return { status: 200, ok: true, json: async () => payload };
  }
  if (String(url).startsWith('/api/kv/')) {
    return { status: 200, ok: true, json: async () => ({ value: '' }) };
  }
  return { status: 404, ok: false, json: async () => ({ error: 'stub' }) };
};

/* ---------- 跑起来 ---------- */
const mod = await import(new URL('../public/js/modules/dividend.js', import.meta.url).href);
if (!registered || registered.id !== 'dividend') throw new Error('模块没有注册到 Billboard.renderers');

const panel = new FakeEl();
await registered.impl.mount({ panel, mod: { id: 'dividend' }, api: window.Billboard.api, toast: () => {}, esc: ESC });

const html = panel.innerHTML;
console.log(`渲染输出长度: ${html.length} 字符`);

const must = [
  ['股票名', '招商银行'],
  ['代码', '601088'],
  ['国债锚数值', '1.6820%'],
  ['3× 锚门槛', '5.05%'],
  ['股息率', '4.91'],
  ['买点价', '39.95'],
  ['股息率网格档位', '3.6× 国债'],
  ['技术位置', '距下轨'],
  ['质量检测', '质量检测'],
  ['信号徽章', '临近'],
  ['用户备注', '测试备注'],
  ['添加输入框', 'id="dv-code"'],
  ['刷新按钮', 'id="dv-refresh"'],
  ['方法说明容器', 'dv-notes'],
  ['免责声明', '不构成投资建议'],
];

let bad = 0;
for (const [name, needle] of must) {
  const ok = html.includes(needle);
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(14)} ${ok ? '' : '找不到 ' + JSON.stringify(needle)}`);
}

// 顺手扫一遍有没有 NaN / undefined 漏进 HTML
const leaks = [...html.matchAll(/\b(NaN|undefined)\b/g)].map((m) => m[0]);
if (leaks.length) {
  console.log(`\n⚠ HTML 里有 ${leaks.length} 处 NaN/undefined 泄漏（前 3 处上下文）：`);
  for (const m of [...html.matchAll(/.{60}\b(NaN|undefined)\b.{60}/g)].slice(0, 3)) {
    console.log('   …' + m[0].replace(/\s+/g, ' ') + '…');
  }
  bad += leaks.length;
} else {
  console.log('\n✓ 没有 NaN / undefined 泄漏到 HTML');
}

globalThis.fetch = realFetch;
if (bad) {
  console.error(`\n❌ 冒烟测试失败：${bad} 项`);
  process.exit(1);
}
console.log('\n✅ 前端渲染冒烟测试通过');
