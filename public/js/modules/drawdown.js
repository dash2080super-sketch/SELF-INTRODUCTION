/* drawdown（回撤与连跌）面板渲染器。
   结构：工具条（窗口 / 地区 / 刷新）→ 指数卡片 → 每日收盘表 → 连涨连跌日历 → 口径说明。
   后端 /api/drawdown 只给原始日线（近 3 个月收盘价），
   回撤、连涨连跌、区间涨跌全部在这里按所选窗口现算，切窗口不再打上游。

   颜色沿用本站口径：涨红跌绿（A 股习惯），CSS 变量 --up / --down。 */
const { esc, toast } = window.Billboard;

let DATA = null;
let WIN = 22; // 默认近 1 个月
let REGION = '全部';
let poller = null;

const WINDOWS = [
  { n: 10, label: '10 日' },
  { n: 22, label: '近 1 个月' },
  { n: 44, label: '近 2 个月' },
  { n: 66, label: '近 3 个月' },
];
const REGIONS = ['全部', '欧洲', '美国', '亚太'];

const nf = (v, d = 2) =>
  v == null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%');
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');

/* ---------------- 计算 ---------------- */

function series(idx) {
  const rows = idx.rows.slice();
  const ch = rows.map((r, i) => (i === 0 ? 0 : (r.close / rows[i - 1].close - 1) * 100));
  return { rows, ch };
}

/** 取该指数最近 WIN 个交易日（各市场休市日不同，所以各自按自己的序列切） */
function slice(idx) {
  const n = Math.min(WIN, idx.rows.length);
  const s = idx.rows.length - n;
  return { rows: idx.rows.slice(s), ch: series(idx).ch.slice(s), s };
}

function metrics(idx) {
  const w = slice(idx);
  const closes = w.rows.map((r) => r.close);
  const last = closes[closes.length - 1];

  // 当前回撤 / 区间最大回撤
  let peak = closes[0];
  let mdd = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    mdd = Math.min(mdd, c / peak - 1);
  }
  const dd = (last / Math.max(...closes) - 1) * 100;

  // 连涨 / 连跌：从最新往前数，平盘(0)中断
  let k = 0;
  let dir = 0;
  for (let i = w.ch.length - 1; i >= 0; i--) {
    const c = w.ch[i];
    if (c === 0) break;
    const d = c > 0 ? 1 : -1;
    if (k === 0) {
      dir = d;
      k = 1;
    } else if (d === dir) k++;
    else break;
  }

  // 连段累计涨跌：从连段起点前一日的收盘算起
  const startIdx = w.rows.length - k;
  let cum = 0;
  if (k > 0) {
    const base = startIdx > 0 ? w.rows[startIdx - 1].close : w.s > 0 ? idx.rows[w.s - 1].close : w.rows[0].close;
    cum = (last / base - 1) * 100;
  }

  const d52 = idx.high52 ? (last / idx.high52 - 1) * 100 : null;
  return {
    last,
    day: w.rows[w.rows.length - 1].date,
    chDay: w.ch[w.ch.length - 1],
    dd,
    mdd: mdd * 100,
    d52,
    k,
    dir,
    cum,
    closes,
    winChg: (last / closes[0] - 1) * 100,
  };
}

/* ---------------- 片段 ---------------- */

function sparkline(closes, w = 280, h = 46) {
  if (!closes || closes.length < 2) return '';
  const mn = Math.min(...closes);
  const mx = Math.max(...closes);
  const rg = mx - mn || 1;
  const step = w / (closes.length - 1);
  const pts = closes.map((c, i) => `${(i * step).toFixed(1)},${(h - 4 - ((c - mn) / rg) * (h - 10)).toFixed(1)}`);
  const col = closes[closes.length - 1] >= closes[0] ? 'var(--up)' : 'var(--down)';
  const lastPt = pts[pts.length - 1].split(',');
  return `<svg class="dd-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(' ')}"/>
      <circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="2.6" fill="${col}"/>
    </svg>`;
}

function cardHTML(idx) {
  const m = metrics(idx);
  const sc = m.dir > 0 ? 'up' : m.dir < 0 ? 'down' : 'flat';
  const label = m.k === 0 ? '无连续（最新平盘）' : m.dir > 0 ? `连涨 ${m.k} 天` : `连跌 ${m.k} 天`;
  return `<div class="dd-card">
    <div class="dd-top">
      <span class="dd-name">${esc(idx.name)}</span>
      <span class="dd-cn">${esc(idx.cn || '')}</span>
      ${idx.note ? `<span class="chip" title="${esc(idx.note)}">代理 ⓘ</span>` : ''}
      <span class="chip">${esc(idx.region || '')}</span>
    </div>
    <div class="dd-px">
      <span class="dd-num">${nf(m.last)}</span>
      <span class="dd-chg ${cls(m.chDay)}">${pct(m.chDay)}</span>
    </div>
    <div class="dd-asof">最新交易日 ${esc(m.day)}${idx.stale ? ' · <span class="dd-stale">上游未更新，用旧值</span>' : ''}</div>
    ${sparkline(m.closes)}
    <div class="dd-kv">
      <div><div class="k">当前回撤</div><div class="v ${m.dd < 0 ? 'down' : 'flat'}">${m.dd < 0 ? m.dd.toFixed(2) + '%' : '0.00%'}</div></div>
      <div><div class="k">区间最大回撤</div><div class="v ${m.mdd < 0 ? 'down' : 'flat'}">${m.mdd.toFixed(2)}%</div></div>
      <div><div class="k">距 52 周高点</div><div class="v ${m.d52 != null && m.d52 < 0 ? 'down' : 'flat'}">${m.d52 == null ? '—' : m.d52.toFixed(2) + '%'}</div></div>
      <div><div class="k">区间涨跌</div><div class="v ${cls(m.winChg)}">${pct(m.winChg)}</div></div>
    </div>
    <div class="dd-streak">
      <span class="dd-badge ${sc}">${label}</span>
      ${m.k > 0 ? `<span class="dd-cum ${sc}">累计 ${pct(m.cum)}</span>` : ''}
    </div>
  </div>`;
}

function tableHTML() {
  const list = DATA.indexes.filter(view);
  const set = new Set();
  for (const i of list) for (const r of i.rows) set.add(r.date);
  const dates = [...set].sort().reverse().slice(0, WIN);
  const head = `<tr><th>日期</th>${list.map((i) => `<th>${esc(i.name)}</th>`).join('')}</tr>`;
  const body = dates
    .map((d) => {
      const tds = list
        .map((i) => {
          const j = i.rows.findIndex((r) => r.date === d);
          if (j < 0) return '<td class="dd-na">—</td>';
          const c = series(i).ch[j];
          return `<td><span class="dd-p">${nf(i.rows[j].close)}</span><span class="dd-c ${cls(c)}">${pct(c)}</span></td>`;
        })
        .join('');
      return `<tr><th>${esc(d)}</th>${tds}</tr>`;
    })
    .join('');
  return `<div class="dd-tablewrap"><table class="dd-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function stripHTML() {
  return DATA.indexes
    .filter(view)
    .map((idx) => {
      const w = slice(idx);
      const m = metrics(idx);
      const start = w.rows.length - (m.k || 0);
      const sq = w.rows
        .map((r, i) => {
          const c = w.ch[i];
          const col = c > 0 ? 'var(--up)' : c < 0 ? 'var(--down)' : 'var(--muted)';
          const cur = m.k > 0 && i >= start ? ' cur' : '';
          return `<i class="${cur.trim()}" style="background:${col}" title="${esc(r.date)}  ${nf(r.close)}  ${pct(c)}"></i>`;
        })
        .join('');
      const lb =
        m.k === 0
          ? '<span class="dd-lb flat">—</span>'
          : `<span class="dd-lb ${m.dir > 0 ? 'up' : 'down'}">${m.dir > 0 ? '连涨' : '连跌'} ${m.k} 天 ${pct(m.cum)}</span>`;
      return `<div class="dd-row"><span class="dd-rn">${esc(idx.name)}</span><span class="dd-sq">${sq}</span>${lb}</div>`;
    })
    .join('');
}

function view(idx) {
  return REGION === '全部' || idx.region === REGION;
}

/* ---------------- 渲染 / 取数 ---------------- */

function shell(panel) {
  panel.innerHTML = `
    <div class="panel-head">
      <h2>回撤与连跌</h2>
      <span class="desc">全球股指 · 每日收盘 / 回撤 / 连涨连跌</span>
      <div class="grow"></div>
      <button class="ghost" id="dd-refresh">刷新</button>
    </div>
    <div class="dd-bar">
      <div class="dd-seg" id="dd-win">${WINDOWS.map(
        (w) => `<button data-n="${w.n}" class="${w.n === WIN ? 'on' : ''}">${w.label}</button>`
      ).join('')}</div>
      <div class="dd-seg" id="dd-region">${REGIONS.map(
        (r) => `<button data-r="${r}" class="${r === REGION ? 'on' : ''}">${r}</button>`
      ).join('')}</div>
      <div class="grow"></div>
      <button class="ghost" id="dd-csv">导出 CSV</button>
      <span class="dd-upd" id="dd-upd"></span>
    </div>
    <div id="dd-body"><div class="empty">正在拉取日线…</div></div>
    <div class="dd-note">
      <b>口径</b>
      <ul>
        <li><b>回撤</b>：最新收盘相对「所选区间内最高收盘」的跌幅；0% 表示正处在区间高点。</li>
        <li><b>区间最大回撤</b>：区间内任一交易日相对此前最高收盘的最大跌幅。</li>
        <li><b>连涨 / 连跌</b>：按收盘价逐日比较，<b>平盘会中断连续计数</b>；括号内为该连段累计涨跌幅。</li>
        <li>各市场休市日不同，每个指数按自己的交易日序列计算，表中休市日留空。</li>
        <li>数据源 Yahoo Finance；TOPIX 用 1306.T（东证 ETF）代理，点位不等于指数本身，但涨跌幅与连涨跌结论一致。</li>
      </ul>
    </div>`;

  panel.querySelector('#dd-refresh').onclick = () => load(panel, true);
  panel.querySelector('#dd-csv').onclick = () => toCSV();
  panel.querySelector('#dd-win').onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    WIN = Number(b.dataset.n);
    [...e.currentTarget.children].forEach((x) => x.classList.toggle('on', x === b));
    try {
      await window.Billboard.api.kvSet('drawdown.win', String(WIN));
    } catch {}
    render(panel);
  };
  panel.querySelector('#dd-region').onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    REGION = b.dataset.r;
    [...e.currentTarget.children].forEach((x) => x.classList.toggle('on', x === b));
    try {
      await window.Billboard.api.kvSet('drawdown.region', REGION);
    } catch {}
    render(panel);
  };
}

function render(panel) {
  const body = panel.querySelector('#dd-body');
  if (!body || !DATA) return;
  const list = DATA.indexes.filter(view);
  body.innerHTML =
    (list.length ? `<div class="dd-grid">${list.map(cardHTML).join('')}</div>` : '') +
    `<div class="dd-sec"><h3>每日收盘与涨跌</h3>
      <div class="dd-hint">每格上排收盘价、下排当日涨跌幅（对比该指数上一个交易日）；空格 = 该市场当日休市。</div>
      ${tableHTML()}</div>` +
    `<div class="dd-sec"><h3>连涨 / 连跌日历</h3>
      <div class="dd-hint">每格一个交易日，从左到右由早到晚；黑框标出当前正在进行的连涨或连跌段。</div>
      <div class="dd-strip">${stripHTML()}</div>
      <div class="dd-legend">
        <span><i style="background:var(--up)"></i>涨</span>
        <span><i style="background:var(--down)"></i>跌</span>
        <span><i style="background:var(--muted)"></i>平盘 / 休市</span>
      </div></div>`;
  const upd = panel.querySelector('#dd-upd');
  if (upd) {
    upd.textContent = `数据更新于 ${esc(DATA.updated || '')}${DATA.errors?.length ? ' · 部分上游取数失败' : ''}`;
  }
}

async function load(panel, force) {
  const btn = panel.querySelector('#dd-refresh');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/drawdown' + (force ? '?refresh=1' : ''));
    if (r.status === 401) {
      location.href = '/login.html';
      return;
    }
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    DATA = j;
    render(panel);
    if (force) toast('已刷新');
  } catch (e) {
    // 拉取失败保留上一次数据，别把面板清空——闪空白比显示旧值更糟
    if (!DATA) {
      const body = panel.querySelector('#dd-body');
      if (body) body.innerHTML = `<div class="empty">拉取失败：${esc(e.message)}<br><br>点右上角刷新再试一次。</div>`;
    } else {
      toast('刷新失败：' + e.message);
      render(panel);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function toCSV() {
  const list = DATA.indexes.filter(view);
  const set = new Set();
  for (const i of list) for (const r of i.rows) set.add(r.date);
  const dates = [...set].sort().reverse().slice(0, WIN);
  const head = ['日期'].concat(list.map((i) => `${i.name} 收盘`)).concat(list.map((i) => `${i.name} 涨跌%`));
  const lines = [head.join(',')];
  for (const d of dates) {
    const row = [d];
    const cs = [];
    for (const i of list) {
      const j = i.rows.findIndex((r) => r.date === d);
      const ch = series(i).ch;
      row.push(j < 0 ? '' : i.rows[j].close);
      cs.push(j < 0 ? '' : ch[j].toFixed(2));
    }
    lines.push(row.concat(cs).join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `drawdown-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function schedule(panel) {
  clearInterval(poller);
  // 日线数据，5 分钟看一眼够了；页面藏起来或不在本面板时不动
  poller = setInterval(() => {
    if (document.hidden) return;
    const p = document.querySelector('.panel[data-id="drawdown"]');
    if (!p || !p.classList.contains('active')) return;
    load(p, false);
  }, 300_000);
}

window.Billboard.register('drawdown', {
  async mount(ctx) {
    const { panel } = ctx;
    shell(panel);

    try {
      const [win, region] = await Promise.all([
        window.Billboard.api.kvGet('drawdown.win'),
        window.Billboard.api.kvGet('drawdown.region'),
      ]);
      const w = Number(win.value);
      if (WINDOWS.some((o) => o.n === w)) WIN = w;
      if (REGIONS.includes(region.value)) REGION = region.value;
      shell(panel); // 用恢复出来的偏好重画工具条
    } catch {}

    await load(panel, false);
    schedule(panel);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      const p = document.querySelector('.panel[data-id="drawdown"]');
      if (!p || !p.classList.contains('active')) return;
      load(p, false);
    });
  },
});
