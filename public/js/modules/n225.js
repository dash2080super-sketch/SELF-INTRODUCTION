/* N225策略 面板渲染器。
   数据完全来自 /api/n225（即 cron 跑 daily_advice.py 落下的 latest.json），
   这里不重算任何判定 —— 判定逻辑只在 Python 侧存在一份，避免两边漂移。

   结构：决策卡（建议 + 仓位系数）→ 三层判定 → 关键指标 → 最近决策 → 口径说明。
   颜色沿用本站口径：涨红跌绿（A 股习惯），CSS 变量 --up / --down。

   【2026-09-23 修订】
   - 「刷新」现在是真刷新（后端重跑 Python），加了进行中状态与失败提示。
   - KOSPI 不再冒充实时：按后端给的 标注/日期 如实展示，非当日时明确标灰。
   - 页脚显示数据龄，超过 2 小时未更新会变红提醒。

   【2026-09-25 修订】修「刷新永远失败且极慢」
   - 后端换了数据源（东财 push2/push2his 在境外机房被东财边缘掐连接，v4/v6 都不行）
     + 净值加磁盘缓存，一次重跑从 ~70s（且必然失败）降到 ~3s。文案里的耗时据此改。
   - cron 同时修了时区 bug：本机是 Asia/Singapore(+08)=北京时间，旧条目按 UTC 写，
     实际都在深夜跑。现在 07:30~14:30 共 8 次，东京早盘每半小时一次。
   - 页脚补了数据源；IOPV 拿不到时显示 —（不参与溢价闸门）。
*/
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

/* "2026-09-23 09:25" -> 距今多少分钟（按北京时间解析） */
function ageMinutes(t) {
  if (!t) return null;
  const d = new Date(String(t).replace(' ', 'T') + ':00+08:00');
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 60000);
}

function ageText(t) {
  const m = ageMinutes(t);
  if (m == null) return '';
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时${m % 60 ? (m % 60) + ' 分' : ''}前`;
  return `${Math.floor(h / 24)} 天前`;
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
  // KOSPI 新版结构；老 latest.json 没有这个键时降级到旧字段
  const k = DATA['KOSPI'] || {};
  const kVal = k['涨跌%'] != null ? k['涨跌%'] : o['KOSPI最新%'];
  const kLabel = k['标注'] ? `KOSPI（${k['标注']}）` : 'KOSPI（同步）';
  const kTone = k['是否当日'] === false ? 'flat' : cls(kVal);

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
    [kLabel, pct(kVal) + (k['日期'] ? `<i class="n225-dim"> ${esc(k['日期'].slice(5))}</i>` : ''), kTone],
    ['综合 score', nf(DATA['综合score']), cls(DATA['综合score'])],
  ];
  return `<div class="n225-grid">${cells
    .map(([key, v, c]) => `<div class="n225-cell"><div class="k">${esc(key)}</div><div class="v ${c}">${v}</div></div>`)
    .join('')}</div>`;
}

function historyHTML() {
  const h = DATA.history || [];
  if (!h.length) return '';
  const slotName = (s) => ({ am: '早间', pm: '午后', manual: '手动' }[s] || '');
  const body = h
    .map(
      (r) => `<tr>
        <td>${esc(r.t || '')}${r.slot ? `<i class="n225-dim"> ${slotName(r.slot)}</i>` : ''}</td>
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
    <div class="n225-hint">同一时段重复跑会覆盖（早间 / 午后各留最后一条）；只记判定，不记成交。</div>
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
          只能做盘中确认。<b>且开盘前拿到的是昨日收盘</b>，格子里的日期就是它的真实数据日。</li>
      <li><b>溢价率才是真因子</b>：按溢价分位分组，&gt;75 分位时未来 20 日 ETF 收益 <b>-0.87%</b>，
          &lt;75 分位时 <b>+3.55%</b>。所以溢价做成一票否决的硬闸门。</li>
      <li><b>被剔除的因子</b>：英伟达（与 SOX 共线，联合回归 t=0.03）、WTI 原油、美债 10Y。
          汇率对 ETF 的净效应接近 0（利好日经但伤害人民币计价净值，两向抵消）。</li>
      <li>样本 2024-09 ~ 2026-09，约 490 个交易日，且是单边上行期；下跌市里溢价可能长期挂在高位，闸门会一直红灯。</li>
      <li><b>数据口径</b>：页面数字来自最近一次判定。服务器<b>按北京时间自动重跑</b>：
          07:30 / 08:00 / 08:30 / 09:00 / 09:25 / 09:30 / 10:00 / 14:30，
          其中 07:30、09:25、14:30 三次会推 Bark，其余静默更新。
          点「刷新」会让服务器<b>立刻重跑一次</b>，约 3~8 秒。</li>
      <li><b>数据源</b>：行情/K线走腾讯（东财 push2/push2his 在境外机房被东财边缘直接掐连接，
          IPv4/IPv6 都一样），官方净值仍取东财（溢价口径的基准）。<b>IOPV 只有东财能给，现在拿不到，显示 —</b>；
          溢价闸门走「收盘价 ÷ 官方净值」，不依赖 IOPV，判定不受影响。</li>
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
  const k = DATA['KOSPI'] || {};
  const q = DATA['数据质量'] || {};
  const age = ageMinutes(DATA['时间']);
  const stale = age != null && age > 120;   // 超过 2 小时没更新 → 提醒
  if (foot) {
    foot.innerHTML =
      `判定时间 ${esc(DATA['时间'] || '')}（北京时间，${esc(ageText(DATA['时间']))}）` +
      `<b class="${stale ? 'down' : ''}">${stale ? ' ⚠ 数据偏旧，点「刷新」重跑' : ''}</b>` +
      `<br>溢价口径「${esc(p['来源'] || '')}」中位 ${pct(p['中位数%'])} / 90 分位 ${pct(p['90分位%'])}` +
      ` · 日经数据日 ${esc(DATA['日经225']['日期'] || '')}` +
      (q['行情源'] ? ` · 数据源 ${esc(q['行情源'])}/${esc(q['K线源'] || '')}` : '') +
      (k['日期'] ? ` · KOSPI 数据日 ${esc(k['日期'])}（${esc(k['标注'] || '')}）` : '');
  }
}

async function load(panel, force) {
  const btn = panel.querySelector('#n225-refresh');
  const body = panel.querySelector('#n225-body');
  if (btn) {
    btn.disabled = true;
    if (force) btn.textContent = '重跑中…';
  }
  // 真刷新要跑 Python，慢，先把正在做的事说清楚，别让人以为卡死
  if (force && DATA && !DATA.error && body) {
    const tip = document.createElement('div');
    tip.className = 'n225-refresh-tip';
    tip.id = 'n225-tip';
    tip.textContent = '正在让服务器重跑判定（抓取上游行情），约 3~8 秒…';
    body.parentNode.insertBefore(tip, body);
  }
  try {
    const r = await fetch('/api/n225' + (force ? '?refresh=1' : ''));
    if (r.status === 401) {
      location.href = '/login.html';
      return;
    }
    const j = await r.json();
    DATA = j;
    render(panel);
    if (force) {
      if (j._refresh && j._refresh.ok === false) toast(j._refresh.msg || '刷新失败');
      else toast('已重跑判定，数据已更新');
    }
  } catch (e) {
    if (!DATA) {
      if (body) body.innerHTML = `<div class="empty">读取失败：${esc(e.message)}</div>`;
    } else {
      toast('刷新失败：' + e.message);
    }
  } finally {
    const tip = panel.querySelector('#n225-tip');
    if (tip) tip.remove();
    if (btn) {
      btn.disabled = false;
      btn.textContent = '刷新';
    }
  }
}

function schedule(panel) {
  clearInterval(poller);
  // cron 一天只跑三次，5 分钟看一眼足够（只读盘，不重跑 Python，很轻）
  poller = setInterval(() => {
    if (document.hidden) return;
    const p = document.querySelector('.panel[data-id="n225"]');
    if (!p || !p.classList.contains('active')) return;
    load(p, false);
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
      load(p, false);
    });
  },
});
