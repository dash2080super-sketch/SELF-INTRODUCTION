/* dividend50 —— 红利 50 专区（典范标的 515450）。
   核心是一句人话：现在该买、该等、还是该卖，买的话买多重。

   数据源：腾讯行情/K线（服务端 30s~1d 缓存）、中债国债曲线（6h）、
   ETF 派息日历（手动维护，页面上有截至日期，别当成自动抓的）。 */
const { esc, toast } = window.Billboard;

let DATA = null;
let timer = null;
let autoMs = 60_000;

const fmt = (v, d = 2) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(d) + '%');
const cls = (v) => (v == null || !Number.isFinite(v) || v === 0 ? 'flat' : v > 0 ? 'up' : 'down');

const TECH_LABEL = { in: '到位', near: '临近', out: '没到', na: '无数据' };
const TECH_CLS = { in: 'ok', near: 'warn', out: 'dim', na: 'dim' };

const STYLE = `
.d50-wrap{max-width:1080px}
.d50-hero{border:1px solid var(--bd,#e3e1da);border-radius:12px;padding:16px 18px;margin:10px 0 14px;background:#fff}
.d50-hero-top{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.d50-act{font-size:26px;font-weight:700;line-height:1.2}
.d50-hero.d50-strong{background:#e1f5ee;border-color:#5dcaa5}
.d50-hero.d50-buy{background:#eaf3de;border-color:#97c459}
.d50-hero.d50-small{background:#e6f1fb;border-color:#85b7eb}
.d50-hero.d50-wait{background:#faeeda;border-color:#fac775}
.d50-hero.d50-hold{background:#f1efe8;border-color:#d3d1c7}
.d50-hero.d50-trim{background:#fcebeb;border-color:#f09595}
.d50-hero.d50-sell{background:#fce9e9;border-color:#e24b4a}
.d50-hero.d50-dim{background:#f1efe8;border-color:#d3d1c7}
.d50-strong .d50-act{color:#0f6e56}.d50-buy .d50-act{color:#3b6d11}
.d50-small .d50-act{color:#185fa5}.d50-wait .d50-act{color:#854f0b}
.d50-hold .d50-act{color:#5f5e5a}.d50-trim .d50-act{color:#a32d2d}
.d50-sell .d50-act{color:#a32d2d}.d50-dim .d50-act{color:#888780}
.d50-stars{font-size:13px;color:#5f5e5a}
.d50-pos{font-size:20px;font-weight:600;color:#185fa5}
.d50-tone{font-size:14px;margin:8px 0 4px;color:#1f2328}
.d50-do{font-size:13.5px;color:#5f5e5a}
.d50-next{margin-top:10px;font-size:13px;color:#854f0b;background:#faeeda;border-radius:8px;padding:6px 10px;display:inline-block}
.d50-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:12px 0}
.d50-m{border:1px solid var(--bd,#e3e1da);border-radius:10px;padding:10px 12px;background:#fff}
.d50-m .l{font-size:12px;color:#888780}
.d50-m .v{font-size:19px;font-weight:600;line-height:1.3}
.d50-m .s{font-size:12px;color:#5f5e5a}
.d50-axis{margin:14px 0 6px}
.d50-axis-bar{position:relative;height:30px;border-radius:6px;background:linear-gradient(90deg,#fcebeb 0%,#faeeda 25%,#f1efe8 45%,#e6f1fb 60%,#eaf3de 75%,#e1f5ee 100%);border:1px solid var(--bd,#e3e1da)}
.d50-tick{position:absolute;top:0;bottom:0;width:1px;background:#888780}
.d50-tick span{position:absolute;top:32px;left:-18px;font-size:11px;color:#5f5e5a;white-space:nowrap}
.d50-pin{position:absolute;top:-4px;width:3px;height:38px;background:#a32d2d;border-radius:2px}
.d50-pin b{position:absolute;top:-16px;left:-16px;font-size:11px;color:#a32d2d;white-space:nowrap}
.d50-axis-cap{font-size:12px;color:#888780;margin-top:26px}
table.d50{width:100%;border-collapse:collapse;font-size:13px;margin:10px 0}
table.d50 th,table.d50 td{border:1px solid var(--bd,#e3e1da);padding:6px 9px;text-align:left}
table.d50 th{background:#f1efe8;font-weight:600}
table.d50 td.n{text-align:right;font-variant-numeric:tabular-nums}
.d50-cells{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:10px 0}
.d50-cell{border:1px solid var(--bd,#e3e1da);border-radius:10px;padding:10px 12px;background:#fff}
.d50-cell.hit{background:#e1f5ee;border-color:#5dcaa5}
.d50-cell .lv{font-size:12px;color:#888780}
.d50-cell .tp{font-size:18px;font-weight:600}
.d50-cell .yl{font-size:12.5px;color:#5f5e5a}
.d50-cell .gp{font-size:12px;color:#854f0b}
.d50-note{background:#e6f1fb;border-left:3px solid #185fa5;border-radius:0 8px 8px 0;padding:10px 14px;margin:12px 0;font-size:13.5px;color:#0c447c}
.d50-warn{background:#faeeda;border-left-color:#854f0b;color:#633806}
.d50-foot{font-size:12px;color:#888780;margin-top:18px;border-top:1px solid var(--bd,#e3e1da);padding-top:10px}
.d50-bar{display:flex;gap:8px;align-items:center;margin:8px 0 4px;flex-wrap:wrap}
.d50-bar select{font-size:13px}
`;

function axisHTML(spread) {
  const S = DATA?.strategy?.spread || {};
  const lo = 1.0;
  const hi = 4.0;
  const pos = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const ticks = [
    { v: S.sell, t: '卖出' },
    { v: S.thin, t: '减仓' },
    { v: S.small, t: '小额' },
    { v: S.buy, t: '买入' },
  ];
  return `<div class="d50-axis">
    <div class="d50-axis-bar">
      ${ticks
        .map((k) => `<div class="d50-tick" style="left:${pos(k.v).toFixed(1)}%"><span>${esc(k.t)} ${fmt(k.v, 1)}</span></div>`)
        .join('')}
      ${
        spread != null
          ? `<div class="d50-pin" style="left:${pos(spread).toFixed(1)}%"><b>现在 ${fmt(spread, 2)}</b></div>`
          : ''
      }
    </div>
    <div class="d50-axis-cap">股债利差刻度（百分点）＝ 股息率 − 十年国债收益率。指针越往右，红利相对国债越划算。</div>
  </div>`;
}

function gridHTML() {
  const g = DATA?.grid || [];
  if (!g.length || g[0]?.price == null) return '<div class="d50-note d50-warn">缺国债锚或派息数据，网格未生成。</div>';
  return `<div class="d50-cells">${g
    .map(
      (c) => `<div class="d50-cell${c.hit ? ' hit' : ''}">
        <div class="lv">利差 ${fmt(c.spread, 1)}pp → 股息率 ${fmt(c.targetYield, 2)}%</div>
        <div class="tp">¥${fmt(c.price, 3)}</div>
        <div class="yl">目标价 = 每份派息 ÷ 目标股息率</div>
        <div class="gp">${c.hit ? '已跌进这一档' : '还差 ' + fmt(Math.abs(c.gapPct), 1) + '%'}</div>
      </div>`
    )
    .join('')}</div>`;
}

function techHTML() {
  const t = DATA?.tech || {};
  const b = DATA?.boll || {};
  const rows = [
    ['日线', t.day, b.day?.lower],
    ['周线', t.week, b.week?.lower],
    ['月线', t.month, b.month?.lower],
  ];
  return `<table class="d50"><tr><th>周期</th><th class="n">距下轨</th><th class="n">下轨价</th><th>状态</th></tr>
    ${rows
      .map(
        ([n, s, lo]) =>
          `<tr><td>${esc(n)}</td><td class="n">${s?.pct == null ? '—' : (s.pct >= 0 ? '+' : '') + s.pct.toFixed(2) + '%'}</td>
           <td class="n">${fmt(lo, 3)}</td>
           <td><span class="chip ${TECH_CLS[s?.state || 'na']}">${TECH_LABEL[s?.state || 'na']}</span></td></tr>`
      )
      .join('')}
    <tr><td>日线上轨</td><td class="n">${DATA?.tech?.upperPct == null ? '—' : DATA.tech.upperPct.toFixed(2) + '%'}</td>
        <td class="n">${fmt(b.day?.upper, 3)}</td><td><span class="chip dim">离上轨越近越要防</span></td></tr>
  </table>`;
}

function layersHTML() {
  const d = DATA;
  const ix = d?.index || {};
  const rows = [
    [
      '战略层<br><span class="d50-m-l">半年–年 · 定仓位中枢</span>',
      '股债性价比 ＝ 股息率 − 十年国债',
      `ETF 派息口径：<b>${fmt(d?.yieldTtm, 2)}% − ${fmt(d?.anchor?.y10, 2)}% ＝ ${fmt(d?.spread, 2)}pp</b><br>
       指数口径（对照）：${fmt(ix.yieldRange?.[1], 2)}% − ${fmt(d?.anchor?.y10, 2)}% ＝ <b>${fmt(ix.spread, 2)}pp</b>`,
    ],
    [
      '战术层<br><span class="d50-m-l">月–季 · 定加减节奏</span>',
      '估值历史分位 + 日周月技术位置',
      `PE-TTM ${fmt(ix.peTtm?.[0], 1)}–${fmt(ix.peTtm?.[1], 1)}（分位 ${fmt(ix.pePercentile?.[0], 1)}%–${fmt(ix.pePercentile?.[1], 1)}%）· PB ${fmt(ix.pb, 2)}<br>
       日线 ${TECH_LABEL[d?.tech?.day?.state || 'na']} / 周线 ${TECH_LABEL[d?.tech?.week?.state || 'na']} / 月线 ${TECH_LABEL[d?.tech?.month?.state || 'na']}`,
    ],
    [
      '执行层<br><span class="d50-m-l">周–月 · 定单笔买点</span>',
      '拥挤度 + 回撤 + 派息节奏',
      `量能比 ${fmt(d?.crowd?.ratio, 2)}（${esc(d?.crowd?.label || '—')}）· 距一年高点 <b>${sign(d?.drawdown)}</b><br>
       近 12 个月派息 ${fmt(d?.payout?.ttm, 3)} 元／份，共 ${d?.payout?.count ?? 0} 次`,
    ],
  ];
  return `<table class="d50"><tr><th style="width:150px">层级</th><th style="width:230px">看什么</th><th>当前读数</th></tr>
    ${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</table>`;
}

function bodyHTML() {
  const d = DATA;
  const a = d?.action || {};
  const f = d?.fund || {};
  const miss = d?.missing || [];

  const hero = `<div class="d50-hero ${a.cls || 'd50-dim'}">
    <div class="d50-hero-top">
      <span class="d50-act">${esc(a.label || '—')}</span>
      <span class="d50-stars">强度 ${'●'.repeat(Math.max(0, Math.abs(a.strength || 0)))}${'○'.repeat(Math.max(0, 5 - Math.abs(a.strength || 0)))}（${a.strength >= 0 ? '买方向' : '卖方向'} ${a.strength}）</span>
      <span class="d50-pos">机动仓 ${(a.positionPct || 0) > 0 ? '+' : ''}${a.positionPct || 0}%</span>
    </div>
    <div class="d50-tone">${esc(a.tone || '')}</div>
    <div class="d50-do"><b>怎么做：</b>${esc(a.do || '')}</div>
    ${
      d?.next && d.next.need > 0
        ? `<div class="d50-next">离「${esc(d.next.target)}」还差利差 ${fmt(d.next.need, 2)} 个百分点</div>`
        : d?.next
          ? `<div class="d50-next">${esc(d.next.target)}</div>`
          : ''
    }
  </div>`;

  const metrics = `<div class="d50-grid">
    <div class="d50-m"><div class="l">现价</div><div class="v ${cls(d?.chgPct)}">¥${fmt(d?.price, 3)}</div><div class="s">${sign(d?.chgPct)} · 换手 ${fmt(d?.turnoverPct, 2)}%</div></div>
    <div class="d50-m"><div class="l">股息率（派息口径）</div><div class="v">${fmt(d?.yieldTtm, 2)}%</div><div class="s">近12月派息 ${fmt(d?.payout?.ttm, 3)} 元/份</div></div>
    <div class="d50-m"><div class="l">十年国债</div><div class="v">${fmt(d?.anchor?.y10, 2)}%</div><div class="s">${esc(d?.anchor?.date || '')} · ${esc(d?.anchor?.src || '')}</div></div>
    <div class="d50-m"><div class="l">股债利差</div><div class="v">${fmt(d?.spread, 2)}pp</div><div class="s">指数口径 ${fmt(d?.index?.spread, 2)}pp</div></div>
    <div class="d50-m"><div class="l">拥挤度</div><div class="v">${fmt(d?.crowd?.ratio, 2)}</div><div class="s">${esc(d?.crowd?.label || '—')}（5日量÷20日量）</div></div>
    <div class="d50-m"><div class="l">距一年高点</div><div class="v ${cls(d?.drawdown)}">${sign(d?.drawdown)}</div><div class="s">回撤越大越接近买点</div></div>
  </div>`;

  return `<div class="d50-wrap">
    ${miss.length ? `<div class="d50-note d50-warn">缺数据：${esc(miss.join(' / '))}。缺一项就不给建议——猜出来的建议比没有更糟。</div>` : ''}
    ${hero}
    ${metrics}
    ${axisHTML(d?.spread)}

    <h3 style="margin:18px 0 4px;font-size:15px">三层信号</h3>
    ${layersHTML()}

    <h3 style="margin:18px 0 4px;font-size:15px">买点网格</h3>
    ${gridHTML()}

    <h3 style="margin:18px 0 4px;font-size:15px">技术位置（布林带 20 / 2σ）</h3>
    ${techHTML()}

    <div class="d50-note"><b>两个口径为什么会差这么多：</b>
      ETF 派息口径用的是<b>这只基金实际发给你的钱</b>（近 12 个月每份 ${fmt(d?.payout?.ttm, 3)} 元 ÷ 现价）；
      指数口径用的是<b>成分股的股息率加权</b>（${fmt(d?.index?.yieldRange?.[0], 2)}%–${fmt(d?.index?.yieldRange?.[1], 2)}%，不同来源口径还不一样）。
      前者是你真正拿到手的，后者常被用来做横向比较。<b>本页定档一律用派息口径</b>，指数口径只作对照。</div>

    <div class="d50-note d50-warn"><b>这套东西不做什么：</b>不预测明天涨跌，也不提示"立刻满仓"。
      红利这类低波品种可赚的价差很薄——专业团队 8 因子周频模型样本外 43 周只比拿着不动多赚 0.19 个百分点。
      所以它只回答一件事：<b>这笔钱现在该投多重</b>。底仓 60%–70% 不参与这些信号，长期持有吃股息。</div>

    <div class="d50-foot">
      ${esc(f.name || '')}（${esc(f.code || '')}）· 跟踪 ${esc(f.indexName || '')}（${esc(f.indexCode || '')}）· 成立 ${esc(f.inception || '')} · ${esc(f.fee || '')} · ${esc(f.connect || '')}<br>
      派息日历手动维护，截至 ${esc(d?.payout?.asOf || '')}；指数侧快照截至 ${esc(d?.index?.asOf || '')}（${esc(d?.index?.src || '')}）。<br>
      数据源：腾讯财经（行情/前复权K线）、中债估值中心（国债收益率曲线）、基金分红公告（派息）。本页为策略研究记录，不构成投资建议。
    </div>
  </div>`;
}

async function load(panel, force) {
  try {
    const r = await fetch('/api/dividend50' + (force ? '?refresh=1' : ''));
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || '请求失败');
    DATA = j;
    render(panel);
  } catch (e) {
    panel.querySelector('.d50-out').innerHTML = `<div class="d50-note d50-warn">加载失败：${esc(e.message)}</div>`;
  }
}

function render(panel) {
  const out = panel.querySelector('.d50-out');
  if (out) out.innerHTML = bodyHTML();
}

function mount(ctx) {
  const { panel } = ctx;
  const styleId = 'd50-style';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  panel.innerHTML = `
    <div class="panel-head">
      <h2>红利50</h2>
      <span class="desc">典范标的 515450 · 六档建议</span>
      <div class="grow"></div>
      <div class="d50-bar">
        <select id="d50-auto">
          <option value="30000">30 秒</option>
          <option value="60000" selected>60 秒</option>
          <option value="300000">5 分钟</option>
          <option value="0">不自动</option>
        </select>
        <button class="ghost" id="d50-refresh">刷新</button>
        <button class="ghost" id="d50-force">强制重算</button>
      </div>
    </div>
    <div class="d50-out"><div class="d50-note">正在拉行情、K 线与国债锚…</div></div>
  `;

  panel.querySelector('#d50-refresh').onclick = () => load(panel, false);
  panel.querySelector('#d50-force').onclick = async () => {
    toast('已忽略缓存，重新打上游');
    await load(panel, true);
  };
  panel.querySelector('#d50-auto').onchange = (e) => {
    autoMs = Number(e.target.value);
    clearInterval(timer);
    if (autoMs > 0) timer = setInterval(() => load(panel, false), autoMs);
  };

  clearInterval(timer);
  if (autoMs > 0) timer = setInterval(() => load(panel, false), autoMs);

  load(panel, false);
}

window.Billboard.register('dividend50', { mount });
