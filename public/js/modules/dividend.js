/* dividend —— 高股息择时面板。
   结构：国债锚条 → 关注列表 → 每只标的的评估卡（股息率网格 / 日周月位置 / 质量检测）→ 方法论注解（可折叠）。

   关于实时：行情走腾讯、分红走东财、国债锚走中债，全在服务端缓存
   （行情 30s / 日线 15min / 周线 6h / 月线 1d / 分红 12h / 国债锚 6h）。
   分红一年才变一两次，国债是日终数据，所以这个板块真正的开销极低——
   刚打开时约 30 多次上游请求，之后每分钟刷新基本全是缓存命中。 */
const { esc } = window.Billboard;

let DATA = null;
let poller = null;
let ticker = null;
let nextAt = 0;
let busy = false;
let refreshMs = 60_000;
let notesOpen = false;

const REFRESH_OPTIONS = [
  { ms: 30_000, label: '30 秒' },
  { ms: 60_000, label: '60 秒（推荐）' },
  { ms: 300_000, label: '5 分钟' },
  { ms: 0, label: '不自动' },
];

const fmt = (v, dec = 2) =>
  v == null || !Number.isFinite(v)
    ? '—'
    : v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

/* A 股惯例：涨红跌绿 */
const cls = (v) => (v == null || !Number.isFinite(v) || v === 0 ? 'flat' : v > 0 ? 'up' : 'down');
const sign = (v, dec = 2) =>
  v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(dec) + '%';

const TECH_LABEL = { in: '进入', near: '临近', out: '未到', na: '无数据' };
const TECH_CLASS = { in: 'ok', near: 'warn', out: 'dim', na: 'dim' };

const SIGNAL_CLASS = {
  resonance: 'sig-buy',
  near: 'sig-near',
  'valuation-ok': 'sig-val',
  wait: 'sig-wait',
  excluded: 'sig-dim',
  nodata: 'sig-dim',
  error: 'sig-err',
};

/* 技术位置一行：周期 / 距下轨百分比 / 下轨价 / 状态。
   注意「距下轨」不是涨跌，别用红绿涨跌色 —— 用状态色：
   进入买点区=红（值得注意）、临近=琥珀、未到=灰。 */
function techRow(label, t, lower) {
  const pct = t?.pct;
  const st = t?.state || 'na';
  const pctCls = st === 'in' ? 'up' : st === 'near' ? 'dv-warn-text' : 'flat';
  return `<div class="dv-tech-row">
    <span class="dtr-l">${esc(label)}</span>
    <span class="dtr-p ${pctCls}">${
      pct == null ? '—' : '距下轨 ' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'
    }</span>
    <span class="dtr-lower">下轨 ${fmt(lower, 2)}</span>
    <span class="chip ${TECH_CLASS[st]}">${TECH_LABEL[st]}</span>
  </div>`;
}

function gridHTML(it) {
  const S = DATA?.strategy || {};
  if (!it.grid?.length) {
    return `<div class="dv-grid-empty">缺分红或国债数据，网格未生成</div>`;
  }
  const cells = it.grid
    .map((g) => {
      const hit = g.hit === true;
      return `<div class="dv-cell${hit ? ' hit' : ''}">
        <div class="dvc-lv">${g.level.toFixed(1)}× 国债</div>
        <div class="dvc-tp">¥${fmt(g.price, 2)}</div>
        <div class="dvc-y">${g.yieldPct.toFixed(2)}%</div>
        <div class="dvc-gap">${hit ? '已达标' : '还差 ' + fmt(Math.abs(g.gapPct), 1) + '%'}</div>
      </div>`;
    })
    .join('');
  const levels = (S.gridLevels || []).join(' / ');
  return `<div class="dv-grid">${cells}</div>
    <div class="dv-grid-hint">档位 ${esc(levels)} 倍国债 · 目标价 = 每股分红 ÷ 目标股息率。
      「已达标」= 现价已跌进这一档（股息率够高了）。</div>`;
}

function qualityHTML(it) {
  const q = it.quality;
  if (!q?.checks?.length) return '';
  const failed = q.checks.filter((c) => !c.ok);
  return `<div class="dv-quality${q.ok ? '' : ' bad'}">
    <span class="dvq-head">质量检测 ${q.ok ? '通过' : '未通过'}</span>
    ${q.checks
      .map(
        (c) => `<span class="chip ${c.ok ? 'ok' : 'hi'}" title="${esc(c.detail)}">${
          c.ok ? '✓' : '✕'
        } ${esc(c.name)}</span>`
      )
      .join('')}
  </div>
  ${
    failed.length
      ? `<div class="dv-quality-why">${failed
          .map((c) => `<div class="dvqw-row"><span class="dvqw-n">${esc(c.name)}</span>${esc(c.detail)}</div>`)
          .join('')}</div>`
      : ''
  }`;
}

function cardHTML(it) {
  const sig = it.signal || { key: 'nodata', label: '数据不足', hint: '' };
  const sigCls = SIGNAL_CLASS[sig.key] || 'sig-dim';
  const S = DATA?.strategy || {};
  const T = S.technical || {};
  const anchor = DATA?.anchor;

  if (it.error) {
    return `<div class="dv-card dv-err" data-id="${it.id}">
      <div class="dvc-head">
        <div class="dvc-title"><span class="dv-name">${esc(it.name)}</span><span class="dv-code">${esc(it.code)}</span></div>
        <div class="dv-badges"><span class="chip sig-err">取数失败</span>
          <button class="ghost dv-del" data-id="${it.id}" title="从关注列表移除">移除</button></div>
      </div>
      <div class="dv-err-msg">${esc(it.error)}</div>
    </div>`;
  }

  const fy = it.fiscal;
  const parts = fy?.parts?.length
    ? fy.parts.map((p) => `${p.period === '12-31' ? '末期' : p.period === '06-30' ? '中期' : p.period} ${p.perShare.toFixed(4)}`).join(' + ')
    : '';
  const special = fy?.parts?.some((p) => p.special);

  const valueMain =
    it.yieldNow != null
      ? `<span class="dvv-num">${it.yieldNow.toFixed(2)}<i>%</i></span>
         <span class="dvv-cmp">vs 3× 锚 ${it.anchor3x != null ? it.anchor3x.toFixed(2) + '%' : '—'}</span>`
      : `<span class="dvv-num muted">—</span>`;

  return `<div class="dv-card" data-id="${it.id}">
    <div class="dvc-head">
      <div class="dvc-title">
        <span class="dv-name">${esc(it.name)}</span>
        <span class="dv-code">${esc(it.code)}</span>
        ${it.userTag ? `<span class="chip">${esc(it.userTag)}</span>` : ''}
      </div>
      <div class="dv-badges">
        <span class="dv-price ${cls(it.chgPct)}">¥${fmt(it.price, 2)} <i>${sign(it.chgPct)}</i></span>
        <span class="chip ${sigCls}" title="${esc(sig.hint)}">${esc(sig.label)}</span>
        <button class="ghost dv-del" data-id="${it.id}" title="从关注列表移除">移除</button>
      </div>
    </div>

    <div class="dv-body">
      <div class="dv-col">
        <div class="dv-kv">
          <div class="dvk-main">${valueMain}</div>
          <div class="dvk-sub">${
            it.gapToTargetPct == null
              ? '缺数据'
              : it.gapToTargetPct <= 0
                ? `<b class="up">已低于 3× 锚买点 ${fmt(Math.abs(it.gapToTargetPct), 1)}%</b>`
                : `距 3× 锚买点（¥${fmt(it.target3, 2)}）还差 ${fmt(it.gapToTargetPct, 1)}%`
          }</div>
        </div>
        <div class="dv-meta">
          <span>PE ${fmt(it.pe, 2)}</span>
          <span>PB ${fmt(it.pb, 2)}</span>
          <span>市值 ${it.mcapYi ? fmt(it.mcapYi, 0) + ' 亿' : '—'}</span>
        </div>
        <div class="dv-div">
          ${
            fy && fy.perShare != null
              ? `最新完整财年 <b>${esc(fy.year)}</b> 每股分红 <b>¥${fy.perShare.toFixed(4)}</b>
                 ${fy.complete ? '' : '<span class="chip mid">财年未完整</span>'}
                 ${special ? '<span class="chip mid">含特别分红</span>' : ''}
                 ${parts ? `<div class="dv-div-parts">${esc(parts)}</div>` : ''}`
              : '<span class="muted">没有分红记录</span>'
          }
        </div>
      </div>

      <div class="dv-col">
        <div class="dv-sec-title">技术位置</div>
        ${techRow('日线', it.tech?.day, it.boll?.day?.lower, T.inPct, T.nearPct)}
        ${techRow('周线', it.tech?.week, it.boll?.week?.lower, T.weekMonthInPct, T.weekMonthNearPct)}
        ${techRow('月线', it.tech?.month, it.boll?.month?.lower, T.weekMonthInPct, T.weekMonthNearPct)}
        ${anchor ? `<div class="dv-anchor-note">国债锚 ${anchor.y10.toFixed(4)}% · ${esc(anchor.date)}（${esc(anchor.src)}）</div>` : ''}
      </div>
    </div>

    <div class="dv-grid-wrap">${gridHTML(it)}</div>
    ${qualityHTML(it)}
    ${it.userNote ? `<div class="dv-note">${esc(it.userNote)}</div>` : ''}
    ${it.missing?.length ? `<div class="dv-missing">缺失数据：${esc(it.missing.join(' / '))}（已停止生成信号）</div>` : ''}
    <div class="dv-signal-hint">${esc(sig.hint || '')}</div>
  </div>`;
}

function notesHTML() {
  const N = DATA?.notes;
  if (!N) return '';
  const section = (title, rows) =>
    `<div class="dv-note-sec"><h4>${esc(title)}</h4>` +
    rows.map(([q, a]) => `<div class="dv-qa"><div class="dvq-q">${esc(q)}</div><div class="dvq-a">${a}</div></div>`).join('') +
    `</div>`;
  return `<div class="dv-notes"${notesOpen ? '' : ' hidden'}>
    ${section('国债锚：为什么是它、为什么乘 3', N.anchor)}
    ${section('股息率网格：怎么把分红换算成买点价格', N.grid)}
    ${section('技术位置：布林带下轨怎么用', N.technical)}
    ${section('质量检测：为什么不能只看股息率排名', N.quality)}
    ${section('等待 / 临近 / 买入共振怎么读', N.signal)}
  </div>`;
}

function headHTML() {
  const m = DATA?.meta || {};
  const c = DATA?.counts || {};
  const a = DATA?.anchor;
  const opts = REFRESH_OPTIONS.map(
    (o) => `<option value="${o.ms}" ${o.ms === refreshMs ? 'selected' : ''}>${esc(o.label)}</option>`
  ).join('');

  return `<div class="panel-head">
    <h2>高股息择时</h2>
    <span class="desc" id="dv-status">—</span>
    <div class="grow"></div>
    <label class="fin-pick">刷新<select id="dv-rate">${opts}</select></label>
    <button class="ghost" id="dv-toggle">${notesOpen ? '收起方法说明' : '方法说明'}</button>
    <button class="primary" id="dv-refresh">刷新</button>
  </div>

  <div class="dv-anchor-bar">
    <div class="dva-item">
      <span class="dva-l">十年国债收益率</span>
      <span class="dva-v">${a ? a.y10.toFixed(4) + '%' : '—'}</span>
      <span class="dva-d">${a ? esc(a.date) : '取数失败'}</span>
    </div>
    <div class="dva-arrow">×3</div>
    <div class="dva-item strong">
      <span class="dva-l">股息率门槛（3× 锚）</span>
      <span class="dva-v">${a ? (a.y10 * (DATA?.strategy?.anchorMultiple || 3)).toFixed(2) + '%' : '—'}</span>
      <span class="dva-d">股息率够这个数，估值条件才成立</span>
    </div>
    <div class="dva-sum">
      <span class="chip blue">关注 ${m.watched ?? 0} 只</span>
      ${c.resonance ? `<span class="chip hi">买入共振 ${c.resonance}</span>` : ''}
      ${c.near ? `<span class="chip mid">临近 ${c.near}</span>` : ''}
      ${c.wait || c['valuation-ok'] ? `<span class="chip">等待 ${(c.wait || 0) + (c['valuation-ok'] || 0)}</span>` : ''}
      ${c.excluded ? `<span class="chip">未过质检 ${c.excluded}</span>` : ''}
    </div>
  </div>

  <div class="fin-meter">
    <span id="dv-meter-text">—</span>
  </div>`;
}

function meterText() {
  const m = DATA?.meta || {};
  return [
    `上游请求 ${m.requests ?? '—'} 次`,
    `缓存命中 ${m.cacheHits ?? '—'} 次`,
    `失败 ${m.errors ?? 0}`,
    `本轮 ${m.lastCycleMs ?? '—'} ms`,
    m.lastError ? `最近错误：${m.lastError}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function tickCountdown() {
  const el = document.getElementById('dv-status');
  if (!el) return;
  if (!refreshMs) {
    el.textContent = '自动刷新已关闭';
    return;
  }
  const left = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
  el.textContent = busy ? '拉取中…' : `${left} 秒后刷新`;
}

function render(panel) {
  const items = DATA?.items || [];
  panel.innerHTML =
    headHTML() +
    `<div class="dv-add">
       <input id="dv-code" placeholder="加自选：6 位代码（如 601088）" inputmode="numeric" maxlength="6">
       <input id="dv-name" placeholder="名称（可留空，自动取）">
       <input id="dv-tag" placeholder="标签（如 煤炭）">
       <input id="dv-note" placeholder="备注（可选）">
       <button class="primary" id="dv-add-btn">添加</button>
     </div>` +
    (items.length
      ? items.map(cardHTML).join('')
      : `<div class="empty">关注列表是空的。上面输入 6 位代码加一只。</div>`) +
    notesHTML() +
    `<div class="fin-foot">${DATA?.notes?.footer ? esc(DATA.notes.footer) : ''}<br>
      本页只做提醒，不构成投资建议。行情与分红数据可能有延迟，请以交易所公告和券商数据为准。</div>`;

  const mt = panel.querySelector('#dv-meter-text');
  if (mt) mt.textContent = meterText();

  panel.querySelector('#dv-refresh').onclick = () => load(panel, true);
  panel.querySelector('#dv-rate').onchange = async (e) => {
    refreshMs = Number(e.target.value);
    schedule();
    try {
      await window.Billboard.api.kvSet('dividend.refreshMs', String(refreshMs));
    } catch {}
  };
  panel.querySelector('#dv-toggle').onclick = async () => {
    notesOpen = !notesOpen;
    const n = panel.querySelector('.dv-notes');
    if (n) n.hidden = !notesOpen;
    panel.querySelector('#dv-toggle').textContent = notesOpen ? '收起方法说明' : '方法说明';
    try {
      await window.Billboard.api.kvSet('dividend.notesOpen', notesOpen ? '1' : '0');
    } catch {}
  };
  panel.querySelector('#dv-add-btn').onclick = () => addItem(panel);
  ['dv-code', 'dv-name', 'dv-tag', 'dv-note'].forEach((id) => {
    const n = panel.querySelector('#' + id);
    if (n) n.onkeydown = (e) => { if (e.key === 'Enter') addItem(panel); };
  });
  panel.querySelectorAll('.dv-del').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); delItem(panel, b.dataset.id); };
  });
}

async function addItem(panel) {
  const code = panel.querySelector('#dv-code').value.trim();
  if (!code) return window.Billboard.toast('先填 6 位股票代码');
  const body = {
    code,
    name: panel.querySelector('#dv-name').value.trim(),
    tag: panel.querySelector('#dv-tag').value.trim(),
    note: panel.querySelector('#dv-note').value.trim(),
  };
  try {
    const r = await fetch('/api/dividend/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || '添加失败');
    window.Billboard.toast('已加入关注列表，正在拉数据…');
    await load(panel, false);
  } catch (e) {
    window.Billboard.toast(e.message);
  }
}

async function delItem(panel, id) {
  if (!confirm('把这个标的从关注列表移除？（只是取消关注，不会删行情数据）')) return;
  try {
    const r = await fetch(`/api/dividend/watchlist/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).error || '删除失败');
    window.Billboard.toast('已移除');
    await load(panel, false);
  } catch (e) {
    window.Billboard.toast(e.message);
  }
}

async function load(panel, force) {
  busy = true;
  const btn = panel.querySelector('#dv-refresh');
  if (btn) btn.disabled = true;
  tickCountdown();
  try {
    const r = await fetch('/api/dividend' + (force ? '?refresh=1' : ''));
    if (r.status === 401) {
      location.href = '/login.html';
      return;
    }
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    DATA = j;
    render(panel);
  } catch (e) {
    if (!DATA) {
      panel.innerHTML = `<div class="panel-head"><h2>高股息择时</h2></div>
        <div class="empty">拉取失败：${esc(e.message)}<br><br>点刷新再试一次。</div>`;
    } else {
      window.Billboard.toast('刷新失败：' + e.message);
      render(panel);
    }
  } finally {
    busy = false;
    nextAt = Date.now() + refreshMs;
    const b = panel.querySelector('#dv-refresh');
    if (b) b.disabled = false;
    tickCountdown();
  }
}

function schedule() {
  clearInterval(poller);
  clearInterval(ticker);
  if (!refreshMs) {
    tickCountdown();
    return;
  }
  nextAt = Date.now() + refreshMs;
  poller = setInterval(() => {
    if (document.hidden) return;
    const p = document.querySelector('.panel[data-id="dividend"]');
    if (!p || !p.classList.contains('active')) return;
    load(p, false);
  }, refreshMs);
  ticker = setInterval(tickCountdown, 1000);
  tickCountdown();
}

window.Billboard.register('dividend', {
  async mount(ctx) {
    const { panel } = ctx;
    panel.innerHTML = `<div class="panel-head"><h2>高股息择时</h2></div>
      <div class="empty">正在拉取行情、分红与国债收益率…</div>`;

    try {
      const [notes, rate] = await Promise.all([
        window.Billboard.api.kvGet('dividend.notesOpen'),
        window.Billboard.api.kvGet('dividend.refreshMs'),
      ]);
      if (notes.value === '1') notesOpen = true;
      const saved = Number(rate.value);
      if (REFRESH_OPTIONS.some((o) => o.ms === saved)) refreshMs = saved;
    } catch {}

    await load(panel, false);
    schedule();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      const p = document.querySelector('.panel[data-id="dividend"]');
      if (!p || !p.classList.contains('active')) return;
      load(p, false);
    });
  },
});
