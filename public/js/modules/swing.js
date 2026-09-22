/* 波段工作台 —— 监控想做波段的 A 股 / 港股，到价换颜色提醒。
 *
 * 和别的模块一样，这里自带 panel 渲染（window.Billboard.register），数据来自 /api/swing/quotes。
 *
 * 交互约定：
 *   - 自动刷新只在这个 panel 处于 active 且页面可见时才跑（和 n225 一致），避免后台白烧 VPS；
 *   - 刷新间隔存 localStorage，默认 5 分钟；
 *   - 行情由服务端抓（约 4 秒一次批拉），并且后台每 60 秒预热一次，
 *     所以点进来通常直接就有数据，不会先白屏。
 *
 * 颜色语义（按 Vic 的要求）：
 *   现价 <= 买点 → 买入色（默认粉红）
 *   现价 >= 卖点 → 卖出色（默认红色，A 股习惯红=涨=该获利了结）
 *   中间 → 不着色
 * 涨跌幅沿用本站口径：红涨绿跌。
 */
const { esc, toast } = window.Billboard;

const S = {
  rows: [],
  meta: null,
  editing: null,   // 正在编辑的 id
  adding: false,
  timer: null,
  interval: 300000, // 默认 5 分钟
  loading: false,
};

const IV_KEY = 'swing:interval';

const INTERVALS = [
  { v: 0, label: '仅手动' },
  { v: 30000, label: '30 秒' },
  { v: 60000, label: '1 分钟' },
  { v: 300000, label: '5 分钟' },
  { v: 600000, label: '10 分钟' },
];

const COLOR_NAMES = {
  pink: '粉红', red: '红色', orange: '橙色',
  blue: '蓝色', green: '绿色', purple: '紫色',
};

const nf = (v, d = 3) =>
  v == null || !Number.isFinite(v) ? '—' : Number(v).toLocaleString('zh-CN', {
    minimumFractionDigits: d, maximumFractionDigits: d,
  });
const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%');
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');

/* ---------------- 片段 ---------------- */

function intervalBar() {
  const opts = INTERVALS
    .map((o) => `<option value="${o.v}" ${o.v === S.interval ? 'selected' : ''}>${o.label}</option>`)
    .join('');
  return `<select id="sw-iv" class="sw-select" title="自动刷新间隔">${opts}</select>`;
}

function legendHTML() {
  return `<div class="sw-legend">
    <span class="sw-chip sw-pink">现价 ≤ 买点 → 考虑买</span>
    <span class="sw-chip sw-red">现价 ≥ 卖点 → 考虑卖</span>
    <span class="sw-chip sw-flat">中间 → 不动</span>
    <span class="sw-note">涨跌幅红涨绿跌。数据由服务端抓取自东方财富延时节点（服务器在海外），下单前请以券商端为准。</span>
  </div>`;
}

function colorOptions(sel) {
  return Object.keys(COLOR_NAMES)
    .map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${COLOR_NAMES[k]}</option>`)
    .join('');
}

/*
 * 一段 20 年 JS 经验换来的教训：`div.innerHTML = '<tr>...'` 是**不行的**。
 * HTML 解析器在 div 的上下文里会把 <tr> <td> 当成垃圾直接丢掉，只剩里面的内容，
 * 于是 class="sw-editing" 这个外壳凭空消失，保存时 querySelector('.sw-editing') 拿到 null。
 * 所以这里分两种形态：
 *   新增表单插进 #sw-body（div）→ 用 div 版；
 *   行内编辑替换 tbody 里的 tr（上下文是 tbody）→ 用 tr 版。
 */
function editorRow(row, asDiv = false) {
  const inner = `<div class="sw-form">
        <label>代码
          <input class="sw-in" data-f="code" value="${esc(row.code || '')}"
                 placeholder="600519 / 000858 / 700" autocomplete="off">
        </label>
        <label>买点（低于此价）
          <input class="sw-in" data-f="buy_price" type="number" step="0.001"
                 value="${row.buy_price || ''}" placeholder="留空=不提醒">
        </label>
        <label>买点颜色
          <select class="sw-in" data-f="buy_color">${colorOptions(row.buy_color || 'pink')}</select>
        </label>
        <label>卖点（高于此价）
          <input class="sw-in" data-f="sell_price" type="number" step="0.001"
                 value="${row.sell_price || ''}" placeholder="留空=不提醒">
        </label>
        <label>卖点颜色
          <select class="sw-in" data-f="sell_color">${colorOptions(row.sell_color || 'red')}</select>
        </label>
        <label>备注
          <input class="sw-in sw-wide" data-f="note" value="${esc(row.note || '')}" placeholder="比如：第二次建仓位">
        </label>
        <div class="sw-btns">
          <button class="primary" data-act="save">保存</button>
          <button class="ghost" data-act="cancel">取消</button>
        </div>
      </div>
      <div class="sw-hint">代码提示：6 位数字按 A 股识别（6/9/5 开头沪市，其余深市，含 15/16 开头的深市 ETF）；少于 6 位或带 HK 按港股识别，写 700 就认腾讯。</div>`;

  return asDiv
    ? `<div class="sw-editing sw-editing-box">${inner}</div>`
    : `<tr class="sw-editing"><td colspan="8">${inner}</td></tr>`;
}

function rowHTML(r) {
  const toneClass = r.tone ? `sw-${r.tone}` : '';
  const badge =
    r.signal === 'buy' ? '<span class="sw-badge sw-badge-buy">到买点</span>'
    : r.signal === 'sell' ? '<span class="sw-badge sw-badge-sell">到卖点</span>'
    : '';
  const distCol =
    r.signal === 'buy' ? `<span class="down">距买点 ${pct(r.distBuy)}</span>`
    : r.signal === 'sell' ? `<span class="up">距卖点 ${pct(r.distSell)}</span>`
    : (r.distBuy != null && r.distSell != null
        ? `<span class="muted">买 ${pct(r.distBuy)} / 卖 ${pct(r.distSell)}</span>`
        : '<span class="muted">—</span>');

  return `<tr class="sw-row ${toneClass}" data-id="${r.id}">
    <td class="sw-code">
      <span class="sw-mkt sw-mkt-${String(r.market || '').toLowerCase()}">${esc(r.market || '?')}</span>
      <b>${esc(r.code)}</b>
      <div class="sw-name">${esc(r.name || '—')}</div>
    </td>
    <td class="sw-price ${cls(r.pct)}">${r.price == null ? '<span class="muted">—</span>' : nf(r.price, r.price < 10 ? 3 : 2) + (r.stale ? '<span class="sw-old" title="上一轮的价格，这轮没拉到">旧</span>' : '')}
      ${badge}</td>
    <td class="${cls(r.pct)}">${pct(r.pct)}</td>
    <td>${r.buy_price ? nf(r.buy_price, r.buy_price < 10 ? 3 : 2) : '<span class="muted">—</span>'}</td>
    <td>${r.sell_price ? nf(r.sell_price, r.sell_price < 10 ? 3 : 2) : '<span class="muted">—</span>'}</td>
    <td class="sw-dist">${r.price == null ? '<span class="muted">无行情</span>' : distCol}</td>
    <td class="sw-note-cell">${esc(r.note || '')}</td>
    <td class="sw-ops">
      <button class="ghost sm" data-act="edit">改</button>
      <button class="ghost sm danger" data-act="del">删</button>
    </td>
  </tr>`;
}

function tableHTML() {
  if (!S.rows.length) {
    return `<div class="empty">还没有标的。点右上角「添加」把你想做波段的票加进来吧。</div>`;
  }
  const body = S.rows.map((r) => rowHTML(r)).join('');
  return `<div class="sw-twrap"><table class="sw-table">
    <thead><tr>
      <th>标的</th><th>现价</th><th>涨跌幅</th><th>买点</th><th>卖点</th><th>距离</th><th>备注</th><th></th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function footHTML() {
  const m = S.meta || {};
  const t = m.fetchedAt ? new Date(m.fetchedAt).toLocaleString('zh-CN', { hour12: false }) : '—';
  const parts = [`数据时间 ${esc(t)}`, `共 ${S.rows.length} 只`];
  if (m.error) parts.push(`<span class="warn">${esc(m.error)}</span>`);
  return `<div class="sw-foot">${parts.join(' · ')}</div>`;
}

/* ---------------- 渲染 ---------------- */

function render(panel) {
  const body = panel.querySelector('#sw-body');
  const foot = panel.querySelector('#sw-foot');
  if (!body) return;
  const parts = [tableHTML(), legendHTML()];
  // 新增表单是插进 #sw-body 这个 div 里的，必须给 div 版（tr 会被解析器吃掉）
  if (S.adding) parts.unshift(editorRow({ id: null, buy_color: 'pink', sell_color: 'red' }, true));
  body.innerHTML = parts.join('');
  if (foot) foot.innerHTML = footHTML();
  bind(panel);
}

function shell(panel) {
  panel.innerHTML = `
    <div class="panel-head">
      <h2>波段工作台</h2>
      <span class="desc">A股 / 港股自选 · 到价换色</span>
      <div class="grow"></div>
      ${intervalBar()}
      <button class="ghost" id="sw-refresh">刷新</button>
      <button class="primary" id="sw-add">添加</button>
    </div>
    <div id="sw-body"><div class="empty">正在读取行情…</div></div>
    <div id="sw-foot"></div>`;

  panel.querySelector('#sw-refresh').onclick = () => load(panel, true);
  panel.querySelector('#sw-add').onclick = () => {
    S.adding = true;
    S.editing = null;
    render(panel);
    const el = panel.querySelector('.sw-editing [data-f="code"]');
    if (el) el.focus();
  };
  const iv = panel.querySelector('#sw-iv');
  if (iv) {
    iv.onchange = () => {
      S.interval = Number(iv.value);
      try { localStorage.setItem(IV_KEY, String(S.interval)); } catch {}
      schedule(panel);
      toast(S.interval ? `每 ${(S.interval / 1000 / 60) >= 1 ? S.interval / 1000 / 60 + ' 分钟' : S.interval / 1000 + ' 秒'}自动刷新` : '已改为手动刷新');
    };
  }
  try {
    const saved = localStorage.getItem(IV_KEY);
    if (saved != null) S.interval = Number(saved);
  } catch {}
}

function collectForm(tr) {
  const out = {};
  tr.querySelectorAll('[data-f]').forEach((el) => {
    out[el.dataset.f] = el.value;
  });
  return out;
}

function bind(panel) {
  panel.querySelectorAll('#sw-body [data-act]').forEach((btn) => {
    btn.onclick = async (e) => {
      const act = btn.dataset.act;
      const tr = btn.closest('tr');
      if (act === 'cancel') {
        S.adding = false;
        S.editing = null;
        render(panel);
        return;
      }
      if (act === 'edit') {
        const id = Number(btn.closest('.sw-row')?.dataset.id);
        const row = S.rows.find((r) => r.id === id);
        if (!row) return;
        S.editing = id;
        S.adding = false;
        // 把这一行换成编辑态
        tr.outerHTML = editorRow(row);
        const ed = panel.querySelector('.sw-editing');
        ed.querySelectorAll('[data-act]').forEach((b) => {
          b.onclick = async () => {
            if (b.dataset.act === 'cancel') {
              S.editing = null;
              render(panel);
              return;
            }
            await save(collectForm(ed), id, panel);
          };
        });
        ed.querySelector('[data-f="code"]')?.focus();
        return;
      }
      if (act === 'del') {
        const id = Number(btn.closest('.sw-row')?.dataset.id);
        const row = S.rows.find((r) => r.id === id);
        if (!row) return;
        if (!confirm(`确定把 ${row.name || row.code} 从列表里删掉？`)) return;
        try {
          await fetch(`/api/swing/watch/${id}`, { method: 'DELETE' });
          toast('已删除');
          await load(panel, true);
        } catch (err) {
          toast('删除失败：' + err.message);
        }
        return;
      }
      if (act === 'save') {
        await save(collectForm(panel.querySelector('.sw-editing')), null, panel);
      }
    };
  });
}

async function save(form, id, panel) {
  const body = {
    code: String(form.code || '').trim(),
    buy_price: form.buy_price === '' ? 0 : Number(form.buy_price),
    sell_price: form.sell_price === '' ? 0 : Number(form.sell_price),
    buy_color: form.buy_color,
    sell_color: form.sell_color,
    note: String(form.note || '').trim(),
  };
  if (!body.code) { toast('请填代码'); return; }
  try {
    const r = await fetch(id ? `/api/swing/watch/${id}` : '/api/swing/watch', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `请求失败 (${r.status})`);
    S.adding = false;
    S.editing = null;
    toast(id ? '已保存' : '已添加');
    await load(panel, true);
  } catch (e) {
    toast('保存失败：' + e.message);
  }
}

/* ---------------- 取数 ---------------- */

async function load(panel, force) {
  const btn = panel.querySelector('#sw-refresh');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/swing/quotes' + (force ? '?refresh=1' : ''));
    if (r.status === 401) { location.href = '/login.html'; return; }
    const j = await r.json();
    S.meta = j;
    S.rows = j.items || [];
    render(panel);
    if (force && !j.error) toast('已刷新');
  } catch (e) {
    const body = panel.querySelector('#sw-body');
    if (body && !S.rows.length) body.innerHTML = `<div class="empty">读取失败：${esc(e.message)}</div>`;
    else toast('刷新失败：' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function schedule(panel) {
  clearInterval(S.timer);
  if (!S.interval) return;
  S.timer = setInterval(() => {
    // 只在「页面可见 + 当前 tab 是它」时轮询，别在后台白烧 VPS
    if (document.hidden) return;
    const p = document.querySelector('.panel[data-id="swing"]');
    if (!p || !p.classList.contains('active')) return;
    load(p, true);
  }, S.interval);
}

window.Billboard.register('swing', {
  async mount(ctx) {
    const { panel } = ctx;
    shell(panel);
    try {
      const saved = localStorage.getItem(IV_KEY);
      if (saved != null) S.interval = Number(saved);
    } catch {}
    await load(panel, false);
    schedule(panel);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      const p = document.querySelector('.panel[data-id="swing"]');
      if (!p || !p.classList.contains('active')) return;
      load(p, false);
    });
  },
});
