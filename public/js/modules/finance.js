/* finance 看板渲染器。
   结构：工具条（刷新频率 / 实时倒计时 / 注解折叠 / 开销显示）→ 6 个分区 → 每区若干指标卡。
   每张卡：名称 + 各腿实时值与涨跌 + 分档标签 + 新鲜度 + 详细注解（可全局折叠）。
   手动指标（AAII / NAAIM / McClellan / Hindenburg）额外给一个录入框。

   关于实时：后端是分级缓存（fast 20s / slow 120s），且"没人在看"时会自动降速 9 倍。
   前端只负责按节奏问后端拿最新快照，真正的节流在服务端，所以多开标签页也不会加倍开销。 */
const { esc } = window.Billboard;

// 数据源的人话名。腿下面那行小字用它，别让界面出现 tv / derived 这种内部代号。
const SRC_NAME = { cnbc: 'CNBC', yahoo: 'Yahoo', tv: 'TradingView', cnn: 'CNN', derived: '本站计算' };

let DATA = null;
let notesOpen = true;
let refreshMs = 20_000;
let poller = null;
let ticker = null;
let nextAt = 0;
let busy = false;

const REFRESH_OPTIONS = [
  { ms: 10_000, label: '10 秒' },
  { ms: 20_000, label: '20 秒（推荐）' },
  { ms: 60_000, label: '60 秒' },
  { ms: 0, label: '不自动' },
];

const fmt = (v, dec) => {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
};
const sign = (v) => (v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%');
const cls = (v) => (v == null || !Number.isFinite(v) || v === 0 ? 'flat' : v > 0 ? 'up' : 'down');

function bandOf(item, v) {
  if (v == null || !Number.isFinite(v) || !item.bands?.length) return null;
  for (const b of item.bands) if (v < b.max) return b;
  return item.bands[item.bands.length - 1];
}

function primaryValue(item) {
  const legs = item.legs || {};
  const keys = Object.keys(legs);
  return keys.length ? legs[keys[0]]?.price ?? null : null;
}

/** 新鲜度：根据数据年龄和该指标的分级给个档位 */
function freshness(item) {
  if (item.tier === 'daily' || item.manual) return null;
  if (item.age == null) return { level: 'old', text: '未取到' };
  const sec = Math.round(item.age / 1000);
  const limit = item.tier === 'fast' ? 45 : 200;
  if (sec <= limit) return { level: 'live', text: sec <= 1 ? '刚刚' : `${sec} 秒前` };
  if (sec <= limit * 3) return { level: 'aging', text: `${sec} 秒前` };
  return { level: 'old', text: Math.round(sec / 60) + ' 分钟前' };
}

function cardHTML(item) {
  const isManual = !!item.manual;
  const mv = item.manualValue;
  const val = isManual ? (mv?.value ?? null) : primaryValue(item);
  const band = bandOf(item, val);
  const fresh = freshness(item);

  let valueHTML;
  if (isManual) {
    valueHTML = `<div class="fv-main">
      <span class="fv-num">${mv?.value == null ? '—' : fmt(mv.value, item.dec)}</span>
      ${item.unit ? `<span class="fv-unit">${esc(item.unit)}</span>` : ''}
    </div>
    <div class="fv-sub">${mv?.date ? `录入日 ${esc(mv.date)}` : '<span class="muted">未录入</span>'}</div>`;
  } else {
    const legs = Object.entries(item.legs || {});
    if (!legs.length) {
      valueHTML = `<div class="fv-main"><span class="fv-num muted">无数据</span></div>
        <div class="fv-sub muted">数据源暂时不可用</div>`;
    } else if (legs.length === 1) {
      const [label, q] = legs[0];
      valueHTML = `<div class="fv-main">
        <span class="fv-num">${fmt(q.price, item.dec)}</span>
        ${item.unit ? `<span class="fv-unit">${esc(item.unit)}</span>` : ''}
        <span class="fv-chg ${cls(q.chgPct)}">${sign(q.chgPct)}</span>
      </div>
      <div class="fv-sub">${esc(label)} · ${esc(SRC_NAME[q.src] || q.src)}</div>`;
    } else {
      valueHTML = `<div class="fv-legs">` +
        legs.map(([label, q]) => `<div class="fv-leg">
            <span class="fl-l">${esc(label)}</span>
            <span class="fl-v">${fmt(q.price, item.dec)}</span>
            <span class="fl-c ${cls(q.chgPct)}">${sign(q.chgPct)}</span>
          </div>`).join('') +
        `</div>`;
    }
  }

  const inputHTML = isManual
    ? `<div class="fin-manual">
        <input type="text" inputmode="decimal" data-mid="${esc(item.id)}" class="mi-value"
          placeholder="${esc(item.manual.placeholder || '')}"
          value="${mv?.value == null ? '' : esc(String(mv.value))}">
        <input type="date" data-mid="${esc(item.id)}" class="mi-date" value="${esc(mv?.date || '')}">
        <button class="ghost" data-save="${esc(item.id)}">保存</button>
        <div class="mi-help">${esc(item.manual.help || '')}</div>
      </div>`
    : '';

  const liveChip = item.tier === 'fast'
    ? `<span class="chip live" title="实时档，约 20 秒刷新">实时</span>`
    : '';

  return `<div class="fin-card${isManual ? ' is-manual' : ''}" data-id="${esc(item.id)}">
    <div class="fc-head">
      <div class="fc-title">
        <span class="fc-name">${esc(item.name)}</span>
        <span class="fc-en">${esc(item.en)}</span>
      </div>
      <div class="fc-badges">
        ${liveChip}
        ${fresh ? `<span class="fresh ${esc(fresh.level)}" title="数据年龄">${esc(fresh.text)}</span>` : ''}
        ${band ? `<span class="band ${esc(band.c)}">${esc(band.label)}</span>` : ''}
      </div>
    </div>
    <div class="fc-value">${valueHTML}</div>
    ${inputHTML}
    <div class="fc-note"${notesOpen ? '' : ' hidden'}>${item.note}</div>
    <div class="fc-src">${esc(item.srcNote || '')}</div>
  </div>`;
}

/* ---------- 工具条 ---------- */
function headHTML() {
  const m = DATA?.meta || {};
  const opts = REFRESH_OPTIONS.map(
    (o) => `<option value="${o.ms}" ${o.ms === refreshMs ? 'selected' : ''}>${esc(o.label)}</option>`
  ).join('');

  return `<div class="panel-head">
    <h2>行情看板</h2>
    <span class="desc" id="fin-status">—</span>
    <div class="grow"></div>
    <label class="fin-pick">刷新
      <select id="fin-rate">${opts}</select>
    </label>
    <button class="ghost" id="fin-toggle">${notesOpen ? '收起全部注解' : '展开全部注解'}</button>
    <button class="primary" id="fin-refresh">刷新</button>
  </div>
  <div class="fin-meter">
    <span class="dot ${m.mode === 'active' ? 'on' : ''}"></span>
    <span id="fin-meter-text">—</span>
  </div>`;
}

function meterText() {
  const m = DATA?.meta || {};
  const fa = m.fastAge == null ? null : Math.round(m.fastAge / 1000);
  const sa = m.slowAge == null ? null : Math.round(m.slowAge / 1000);
  return [
    `实时档 ${fa == null ? '—' : fa + ' 秒前'}`,
    `常规档 ${sa == null ? '—' : sa + ' 秒前'}`,
    `模式 ${m.mode === 'active' ? '全速（你在看）' : '省电（无人观看）'}`,
    `上游请求 ${m.requests ?? '—'} 次`,
    `失败 ${m.errors ?? 0} 次`,
    `本轮 ${m.lastCycleMs ?? '—'} ms`,
  ].join(' · ');
}

function tickCountdown() {
  const el = document.getElementById('fin-status');
  if (!el) return;
  if (!refreshMs) {
    el.textContent = '自动刷新已关闭';
    return;
  }
  const left = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
  el.textContent = busy ? '拉取中…' : `${left} 秒后刷新`;
}

/* ---------- 渲染 ---------- */
function render(panel) {
  const zones = DATA.zones || [];
  panel.innerHTML =
    headHTML() +
    zones.map((z) => `<div class="fin-zone">
      <div class="fz-head"><span class="fz-icon">${esc(z.icon)}</span><span class="fz-name">${esc(z.name)}</span>
        <span class="fz-desc">${esc(z.desc)}</span></div>
      <div class="fz-cards">${z.items.map(cardHTML).join('')}</div>
    </div>`).join('') +
    `<div class="fin-foot">
      实时档（期货 / 股指 / 汇率 / 金银油）约 20 秒刷新，其余约 120 秒。
      你关掉页面或切走 90 秒后，服务端自动降到省电模式（间隔放大 9 倍），几乎不发请求。
      数据源：CNBC / Yahoo Finance / CNN Business / TradingView（欧洲与日本股指期货，约 15 分钟延迟）。延迟报价，仅供观察，不构成投资建议。
    </div>`;

  panel.querySelector('#fin-meter-text').textContent = meterText();

  panel.querySelector('#fin-refresh').onclick = () => load(panel, true);
  panel.querySelector('#fin-rate').onchange = async (e) => {
    refreshMs = Number(e.target.value);
    schedule();
    try {
      await window.Billboard.api.kvSet('finance.refreshMs', String(refreshMs));
    } catch {}
  };
  panel.querySelector('#fin-toggle').onclick = async () => {
    notesOpen = !notesOpen;
    panel.querySelectorAll('.fc-note').forEach((n) => (n.hidden = !notesOpen));
    panel.querySelector('#fin-toggle').textContent = notesOpen ? '收起全部注解' : '展开全部注解';
    try {
      await window.Billboard.api.kvSet('finance.notesOpen', notesOpen ? '1' : '0');
    } catch {}
  };
  panel.querySelectorAll('[data-save]').forEach((btn) => {
    btn.onclick = () => saveManual(panel, btn.dataset.save);
  });
  panel.querySelectorAll('.mi-value,.mi-date').forEach((inp) => {
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') saveManual(panel, inp.dataset.mid);
    };
  });
}

async function saveManual(panel, id) {
  const card = panel.querySelector(`.fin-card[data-id="${id}"]`);
  if (!card) return;
  const value = card.querySelector('.mi-value').value.trim();
  const date = card.querySelector('.mi-date').value.trim();
  try {
    const r = await fetch('/api/finance/manual', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, value, date }),
    });
    if (!r.ok) throw new Error((await r.json()).error || '保存失败');
    window.Billboard.toast('已保存');
    await load(panel, false);
  } catch (e) {
    window.Billboard.toast(e.message);
  }
}

async function load(panel, force) {
  busy = true;
  const btn = panel.querySelector('#fin-refresh');
  if (btn) btn.disabled = true;
  tickCountdown();

  try {
    const r = await fetch('/api/finance' + (force ? '?refresh=1' : ''));
    if (r.status === 401) {
      location.href = '/login.html';
      return;
    }
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    DATA = j;
    render(panel);
  } catch (e) {
    // 拉取失败时保留上一次的数据，不把面板清空——闪空白比显示旧值更糟
    if (!DATA) {
      panel.innerHTML = `<div class="panel-head"><h2>行情看板</h2></div>
        <div class="empty">拉取失败：${esc(e.message)}<br><br>点刷新再试一次。</div>`;
    } else {
      window.Billboard.toast('刷新失败：' + e.message);
      render(panel);
    }
  } finally {
    busy = false;
    nextAt = Date.now() + refreshMs;
    const b = panel.querySelector('#fin-refresh');
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
    const p = document.querySelector('.panel[data-id="finance"]');
    if (!p || !p.classList.contains('active')) return;
    load(p, false);
  }, refreshMs);
  ticker = setInterval(tickCountdown, 1000);
  tickCountdown();
}

window.Billboard.register('finance', {
  async mount(ctx) {
    const { panel } = ctx;
    panel.innerHTML = `<div class="panel-head"><h2>行情看板</h2></div>
      <div class="empty">正在拉取全球行情…</div>`;

    try {
      const [notes, rate] = await Promise.all([
        window.Billboard.api.kvGet('finance.notesOpen'),
        window.Billboard.api.kvGet('finance.refreshMs'),
      ]);
      if (notes.value === '0') notesOpen = false;
      const saved = Number(rate.value);
      if (REFRESH_OPTIONS.some((o) => o.ms === saved)) refreshMs = saved;
    } catch {}

    await load(panel, false);
    schedule();

    // 回到前台时立刻补一次，不用等下一个周期
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      const p = document.querySelector('.panel[data-id="finance"]');
      if (!p || !p.classList.contains('active')) return;
      load(p, false);
    });
  },
});
