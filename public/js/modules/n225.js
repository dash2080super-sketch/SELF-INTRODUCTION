/* N225策略 面板渲染器。
   数据完全来自 /api/n225（即 cron 跑 daily_advice.py 落下的 latest.json），
   这里不重算任何判定 —— 判定逻辑只在 Python 侧存在一份，避免两边漂移。

   结构：决策卡（建议 + 仓位系数）→ 三层判定 → 关键指标 → 最近决策 → 口径说明。
   颜色沿用本站口径：涨红跌绿（A 股习惯），CSS 变量 --up / --down。 */
const { esc, toast } = window.Billboard;

let DATA = null;
let poller = null;

const nf = (v, d = 2) =>
  v == null || !Number.isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%');
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');

/* 建议 -> 配色 */
function actionTone(a) {
  if (!a) return 'flat';
  if (a.includes('减仓') || a.includes('卖出')) return 'down';
  if (a.includes('不买入') || a.includes('保持不动')) return 'flat';
  if (a.includes('小额')) return 'warn';
  return 'up';
}

/* 溢价分位 -> 红黄绿 */
function premTone(p) {
  if (p == null) return 'flat';
  if (p >= 90) return 'down';
  if (p >= 75) return 'warn';
  return 'up';
}

/* ---------------- 片段 ---------------- */

function verdictHTML() {
  const d = DATA['判定'];
  const tone = actionTone(d['操作建议']);
  return `<div class="n225-verdict ${tone}">
    <div class="n225-vleft">
      <div class="n225-vlabel">操作建议</div>
      <div class="n225-vaction">${esc(d['操作建议'])}</div>
      <div class="n225-vsub">${esc(d['情绪说明'])}</div>
    </div>
    <div class="n225-vright">
      <div class="n225-vlabel">建议仓位系数</div>
      <div class="n225-vsize">${nf(d['建议仓位系数'])}<span>×基准</span></div>
    </div>
  </div>`;
}

function layersHTML() {
  const d = DATA['判定'];
  const p = DATA['溢价'];
  const n = DATA['日经225'];
  const rows = [
    {
      k: '溢价闸门',
      v: d['闸门说明'],
      tone: premTone(p['历史分位']),
      badge: `分位 ${nf(p['历史分位'], 0)}%`,
    },
    {
      k: '金字塔档位',
      v: `日经距一年高点回撤 ${nf(n['回撤%'])}%，落在「${esc(d['金字塔档位'])}」`,
      tone: n['回撤%'] <= -10 ? 'up' : n['回撤%'] <= -3 ? 'warn' : 'flat',
      badge: esc(d['金字塔档位']),
    },
    {
      k: '情绪节奏',
      v: d['情绪说明'],
      tone: d['情绪'] === 'LOW' ? 'up' : d['情绪'] === 'HIGH' ? 'warn' : 'flat',
      badge: `score ${nf(DATA['综合score'])}`,
    },
  ];
  return `<div class="n225-layers">${rows
    .map(
      (r) => `<div class="n225-layer ${r.tone}">
        <div class="n225-lk">${esc(r.k)}<span class="n225-badge">${esc(r.badge)}</span></div>
        <div class="n225-lv">${esc(r.v)}</div>
      </div>`
    )
    .join('')}</div>`;
}

function metricsHTML() {
  const e = DATA['ETF_513880'];
  const p = DATA['溢价'];
  const n = DATA['日经225'];
  const o = DATA['隔夜美股'];
  const cells = [
    ['ETF 现价', nf(e['现价'], 3), cls(e['今日涨幅%'])],
    ['今日涨幅', pct(e['今日涨幅%']), cls(e['今日涨幅%'])],
    ['IOPV', nf(e['IOPV'], 3), 'flat'],
    ['成交额', nf(e['成交额(亿)']) + ' 亿', 'flat'],
    ['溢价率', pct(p['当前%']), premTone(p['历史分位'])],
    ['溢价历史分位', nf(p['历史分位'], 0) + '%', premTone(p['历史分位'])],
    ['日经 225', nf(n['最新收盘'], 0), 'flat'],
    ['距一年高点', pct(n['回撤%']), cls(n['回撤%'])],
    ['隔夜 SOX', pct(o['SOX%']), cls(o['SOX%'])],
    ['隔夜英伟达', pct(o['英伟达%']), cls(o['英伟达%'])],
    ['隔夜 VIX', pct(o['VIX%']), cls(o['VIX%'])],
    ['USD/JPY', pct(o['USDJPY%']), cls(o['USDJPY%'])],
    ['KOSPI（同步）', pct(o['KOSPI最新%']), cls(o['KOSPI最新%'])],
    ['综合 score', nf(DATA['综合score']), cls(DATA['综合score'])],
  ];
  return `<div class="n225-grid">${cells
    .map(([k, v, c]) => `<div class="n225-cell"><div class="k">${esc(k)}</div><div class="v ${c}">${esc(v)}</div></div>`)
    .join('')}</div>`;
}

function historyHTML() {
  const h = DATA.history || [];
  if (!h.length) return '';
  const body = h
    .map(
      (r) => `<tr>
        <td>${esc(r.t || '')}</td>
        <td class="${actionTone(r.action)}">${esc(r.action || '')}</td>
        <td>${r.size == null ? '—' : nf(r.size)}</td>
        <td>${r.prem == null ? '—' : pct(r.prem)}</td>
        <td>${r.premPct == null ? '—' : nf(r.premPct, 0) + '%'}</td>
        <td class="${cls(r.dd)}">${r.dd == null ? '—' : pct(r.dd)}</td>
        <td class="${cls(r.sox)}">${r.sox == null ? '—' : pct(r.sox)}</td>
        <td>${r.score == null ? '—' : nf(r.score)}</td>
      </tr>`
    )
    .join('');
  return `<div class="n225-sec"><h3>最近决策</h3>
    <div class="n225-hint">每次 cron 跑完追加一条；只记判定，不记成交。</div>
    <div class="n225-twrap"><table class="n225-table">
      <thead><tr><th>时间(北京)</th><th>建议</th><th>仓位</th><th>溢价</th><th>分位</th><th>回撤</th><th>SOX</th><th>score</th></tr></thead>
      <tbody>${body}</tbody></table></div></div>`;
}

function noteHTML() {
  return `<div class="n225-note">
    <b>这套规则是怎么来的</b>
    <ul>
      <li><b>隔夜美股信号吃不到</b>：日经 8:00（北京时间）开盘就把 SOX / 英伟达的信息兑现成跳空，
          513880 要 9:30 才开盘。实测隔夜 SOX 与「ETF 开盘买→收盘卖」的相关性只有 <b>-0.06</b>，
          所以隔夜信号只用来调节奏，不用来做日内择时。</li>
      <li><b>KOSPI 不是领先指标</b>：韩日同为 UTC+9、同为 9:00 开盘，同日相关 0.668 是同步共振，
          只能做盘中确认。</li>
      <li><b>溢价率才是真因子</b>：按溢价分位分组，&gt;75 分位时未来 20 日 ETF 收益 <b>-0.87%</b>，
          &lt;75 分位时 <b>+3.55%</b>。所以溢价做成一票否决的硬闸门。</li>
      <li><b>被剔除的因子</b>：英伟达（与 SOX 共线，联合回归 t=0.03）、WTI 原油、美债 10Y。
          汇率对 ETF 的净效应接近 0（利好日经但伤害人民币计价净值，两向抵消）。</li>
      <li>样本 2024-09 ~ 2026-09，约 490 个交易日，且是单边上行期；下跌市里溢价可能长期挂在高位，闸门会一直红灯。</li>
    </ul>
  </div>`;
}

/* ---------------- 渲染 / 取数 ---------------- */

function shell(panel) {
  panel.innerHTML = `
    <div class="panel-head">
      <h2>N225策略</h2>
      <span class="desc">日经225 ETF(513880) · 溢价闸门 + 金字塔档位 + 隔夜情绪</span>
      <div class="grow"></div>
      <button class="ghost" id="n225-refresh">刷新</button>
    </div>
    <div id="n225-body"><div class="empty">正在读取最新判定…</div></div>
    <div class="n225-foot" id="n225-foot"></div>
    ${noteHTML()}`;

  panel.querySelector('#n225-refresh').onclick = () => load(panel, true);
}

function render(panel) {
  const body = panel.querySelector('#n225-body');
  const foot = panel.querySelector('#n225-foot');
  if (!body) return;

  if (DATA.error) {
    body.innerHTML = `<div class="empty">${esc(DATA.error)}</div>`;
    if (foot) foot.textContent = '';
    return;
  }

  body.innerHTML =
    verdictHTML() +
    layersHTML() +
    `<div class="n225-sec"><h3>关键指标</h3>${metricsHTML()}</div>` +
    historyHTML();

  const p = DATA['溢价'];
  if (foot) {
    foot.textContent =
      `判定时间 ${esc(DATA['时间'] || '')}（北京时间）· 溢价口径「${esc(p['来源'] || '')}」` +
      `，中位 ${pct(p['中位数%'])} / 90 分位 ${pct(p['90分位%'])} · 日经数据日期 ${esc(DATA['日经225']['日期'] || '')}`;
  }
}

async function load(panel, force) {
  const btn = panel.querySelector('#n225-refresh');
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/n225' + (force ? '?refresh=1' : ''));
    if (r.status === 401) {
      location.href = '/login.html';
      return;
    }
    const j = await r.json();
    DATA = j;
    render(panel);
    if (force && !j.error) toast('已刷新');
  } catch (e) {
    if (!DATA) {
      const body = panel.querySelector('#n225-body');
      if (body) body.innerHTML = `<div class="empty">读取失败：${esc(e.message)}</div>`;
    } else {
      toast('刷新失败：' + e.message);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function schedule(panel) {
  clearInterval(poller);
  // cron 一天只跑两次，5 分钟看一眼足够
  poller = setInterval(() => {
    if (document.hidden) return;
    const p = document.querySelector('.panel[data-id="n225"]');
    if (!p || !p.classList.contains('active')) return;
    load(p, true);
  }, 300_000);
}

window.Billboard.register('n225', {
  async mount(ctx) {
    const { panel } = ctx;
    shell(panel);
    await load(panel, false);
    schedule(panel);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      const p = document.querySelector('.panel[data-id="n225"]');
      if (!p || !p.classList.contains('active')) return;
      load(p, true);
    });
  },
});
