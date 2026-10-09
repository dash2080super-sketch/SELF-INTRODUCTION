/* NASDAQ & S&P 加仓决策 面板渲染器。
 *
 * 铁律：这里 **一个判定都不重算**。所有 tier / amount / 熔断 / 门D 都来自 Python 落下的
 * latest.json，前端只负责把数字摆清楚。否则页面和 cron 跑出来的结论会对不上。
 *
 * 结构：
 *   决策卡（红绿灯）→ 两条腿 → ERP 坐标轴（一眼看距离）→ 历史曲线
 *   → 因子快照（观察项，权重 0%）→ 门 D → 熔断 → 判定历史 → 口径说明
 *
 * 颜色沿用本站口径：红=可投/进取（A 股习惯），绿=停手，灰=不可执行。
 */
const { esc, toast } = window.Billboard;

let DATA = null;
let poller = null;

/* L0 月度定投的记账开关：
 *   L0DONE = 本月（北京时间 YYYY-MM）的定额是否已经打过。
 *   L0KEY  = 上一次同步用的 kv key，用来发现「页面开着跨月了」。
 * 详见文末 l0ToggleHTML() / syncL0()。 */
let L0DONE = false;
let L0KEY = '';

/* ---------------- 小工具 ---------------- */

const nf = (v, d = 2) =>
  v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d);
const pct = (v, d = 2) =>
  v == null || !Number.isFinite(Number(v)) ? '—' : (Number(v) > 0 ? '+' : '') + Number(v).toFixed(d) + '%';
const pp = (v, d = 2) =>
  v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d) + 'pp';
const cls = (v) => (Number(v) > 0 ? 'up' : Number(v) < 0 ? 'down' : 'flat');

/* 决策 -> 红绿灯 */
function actionTone(a, can) {
  if (can === false) return 'flat';
  const s = String(a || '');
  if (s.includes('不加')) return 'down';
  if (s.includes('只能投')) return 'warn';
  return 'up';
}

/* tier -> 配色（越深越"便宜"，用红色强调） */
function tierTone(t) {
  if (t === 'L3') return 'up';
  if (t === 'L2') return 'up';
  if (t === 'L1') return 'warn';
  return 'flat';
}

/* "2026-09-23 17:42:04" -> 距今（按北京时间解析） */
function ageMinutes(t) {
  if (!t) return null;
  const d = new Date(String(t).replace(' ', 'T') + '+08:00');
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

/* ---------------- L0 月度已投开关 ----------------
 *
 * 为什么要有这个：L0 是 **月度** 额度（0.15% 总权益/月），但 cron 天天跑，
 * 面板就会天天显示「可以投 L0 0.150%」—— 看几天就买几次，是最容易犯的错。
 *
 * 为什么不放进 Python：判定逻辑必须只有一份（铁律）。这是「记账」，不是「判定」，
 * 所以放前端，用站点通用 kv 存。key 里带月份 → 跨月天然复位，不用写清理逻辑。
 *
 * 只封 L0，不封触发层：L1–L3 是跌出来的机会，不能被「这个月投过了」拦住。
 */

/* 北京时间（UTC+8）的 YYYY-MM。服务器在新加坡也是 +8，直接按本地时钟偏移即可 */
function monthKey() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
function nextMonth() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  let y = d.getUTCFullYear(), m = d.getUTCMonth() + 2;   // getUTCMonth 0 基，+2 = 下个月
  if (m > 12) { m -= 12; y += 1; }
  return y + '-' + String(m).padStart(2, '0');
}
const l0Key = () => 'ndxspx.l0.' + monthKey();

async function syncL0() {
  const k = l0Key();
  try {
    const kv = window.Billboard && window.Billboard.kvGet;
    const j = kv ? await kv(k) : null;
    L0DONE = !!(j && String(j.value) === '1');
  } catch (e) {
    L0DONE = false;   // 读不到就当「没投」—— 宁可多提醒一次，也别把真该投的给漏了
  }
  L0KEY = k;
}

function l0ToggleHTML() {
  return `<div class="nspx-l0">
    <label class="nspx-l0box">
      <input type="checkbox" id="nspx-l0done"${L0DONE ? ' checked' : ''}>
      <b>本月（${monthKey()}）定投已执行</b>
    </label>
    <div class="nspx-dim">L0 是<b>月度</b>额度，不是每天。勾上后它显示为「已用」，避免同一月份重复扣款；
      到 ${nextMonth()}-01（北京时间）自动复位，不用手动清。
      这是记账开关，<b>只改显示、不改判定</b>，也不影响触发层（L1–L3）。</div>
  </div>`;
}

function wireL0(panel) {
  const cb = panel.querySelector('#nspx-l0done');
  if (!cb) return;
  cb.onchange = async () => {
    const want = cb.checked;
    cb.disabled = true;
    try {
      const kv = window.Billboard && window.Billboard.kvSet;
      if (!kv) throw new Error('站点缺少 kv 接口');
      await kv(l0Key(), want ? '1' : '0');
      L0DONE = want;
      render(panel);
      toast(want ? `已记账：${monthKey()} 定投已执行` : `已撤销：${monthKey()} 定投未执行`);
    } catch (e) {
      cb.checked = !want;          // 没写进去就别假装状态变了
      toast('保存失败：' + ((e && e.message) || e));
    } finally {
      cb.disabled = false;
    }
  };
}

/* ---------------- 片段 ---------------- */

function verdictHTML() {
  const d = DATA.decision || {};
  const legs = d.legs || [];
  /* 金额拆两块：L0 月度定投 / 触发层（L1–L3）。月度开关只封 L0。 */
  const isL0 = (x) => x.can_add && x.tier === 'L0';
  const isTrig = (x) => x.can_add && x.tier && x.tier !== 'L0';
  const sum = (f) => legs.filter(f).reduce((s, x) => s + (Number(x.amount_pct) || 0), 0);
  const l0Sum = sum(isL0), trigSum = sum(isTrig);
  const total = (L0DONE ? 0 : l0Sum) + trigSum;
  /* 只有当「能封的部分全被封住」时，整卡才转成灰色 —— 触发层还在就不算 */
  const usedUp = L0DONE && l0Sum > 0 && trigSum <= 0;
  const tone = usedUp ? 'flat' : actionTone(d.action, d.can_add);
  const fng = DATA.fng || {};

  const sizeLabel = usedUp ? '本月剩余' : trigSum > 0 ? '本次可投' : '本月可投';
  const hintParts = [];
  if (l0Sum > 0) {
    hintParts.push(L0DONE
      ? `<s>L0 ${nf(l0Sum, 3)}%</s> 本月已用`
      : `L0 ${nf(l0Sum, 3)}%<i class="nspx-dim">（月度，不是每天）</i>`);
  }
  if (trigSum > 0) {
    hintParts.push(legs.filter(isTrig).map((x) => `${x.leg} ${nf(x.amount_pct, 3)}%`).join(' + '));
  }
  const hint = hintParts.join(' ／ ') || '两腿均暂停';

  return `<div class="nspx-verdict ${tone}">
    <div class="nspx-vleft">
      <div class="nspx-vlabel">今日判定（北京时间 ${esc(DATA.generated_at || '')}）</div>
      <div class="nspx-vaction">${esc(usedUp ? '本月额度已用' : (d.action || '—'))}</div>
      <div class="nspx-vsub">${esc(d.headline || '')}</div>
    </div>
    <div class="nspx-vright">
      <div class="nspx-vlabel">${sizeLabel}${trigSum <= 0 && l0Sum > 0 ? '（月度额度）' : ''}</div>
      <div class="nspx-vsize${usedUp ? ' used' : ''}">${nf(total, 3)}<span>% 总权益</span></div>
      <div class="nspx-vhint">${hint}</div>
    </div>
  </div>
  ${L0DONE ? `<div class="nspx-alert info">🗓 ${monthKey()} 的 L0 月度额度已记账为「已投」—— 本月不再提示定投。下月 1 日（北京时间）自动复位。</div>` : ''}
  ${DATA.freshness && DATA.freshness.stale ? `<div class="nspx-alert">⚠ ${esc(DATA.freshness.hint || '基准 PE 已过期，请重填')}</div>` : ''}
  ${(DATA.warnings || []).length ? `<div class="nspx-alert warn">⚠ ${(DATA.warnings || []).map(esc).join('；')}</div>` : ''}
  ${(d.frozen_tiers || []).length ? `<div class="nspx-alert down">🧊 已冻结：${(d.frozen_tiers || []).map(esc).join(' / ')}（熔断生效，今日不可投放这些层；L0 不受影响）</div>` : ''}
  ${DATA.ratio && DATA.ratio.below_gate ? `<div class="nspx-alert down">⛔ QQQ/SPY 比率 ${nf(DATA.ratio.ratio, 4)} 已跌破总开关 ${nf(DATA.ratio.gate, 4)}，NDX 腿整体暂停（含 L1–L3）</div>` : ''}
  ${fng.score != null && fng.score < 40 && DATA.legs && DATA.legs.spx && DATA.legs.spx.erp_pp < 0 ? `<div class="nspx-alert warn">👀 F&amp;G ${nf(fng.score)} 在恐惧区，但 ERP 仍为负、${DATA.vol && DATA.vol.vix != null ? 'VIX ' + nf(DATA.vol.vix) + ' 处自满区' : '波动率不高'} —— 单独看恐惧指标会买在极值上，本系统按终裁 T10 不给它权重。</div>` : ''}`;
}

function legCardHTML(x) {
  const lk = String(x.leg || '').toLowerCase();
  const tk = lk === 'spy' ? 'spy' : 'qqq';
  const tech = (DATA.tech || {})[tk] || {};
  const idxK = lk === 'spy' ? 'spx' : 'ndx';
  const idx = (DATA.legs || {})[idxK] || {};
  /* 勾了「本月已投」的 L0 腿：金额划掉、徽章改「本月已用」，但数字照旧显示 */
  const usedUp = L0DONE && x.can_add && x.tier === 'L0';
  const tone = usedUp ? 'flat' : (x.can_add ? tierTone(x.tier) : 'flat');
  const rows = [
    ['当前层', x.tier || '—', ''],
    ['盈利收益率', pp(idx.ey_now_pct ? Number(idx.ey_now_pct) : null), 'flat'],
    ['ERP', pp(idx.erp_pp != null ? Number(idx.erp_pp) : null), Number(idx.erp_pp) > 0 ? 'up' : 'down'],
    ['距 L1 需再跌', pct(Number(x.need_drop_L1_pct)), 'flat'],
  ];
  return `<div class="nspx-leg ${tone}">
    <div class="nspx-leghead">
      <div class="nspx-legname">${esc(x.leg)}<span class="nspx-badge ${usedUp ? 'no' : (x.can_add ? 'ok' : 'no')}">${usedUp ? '本月已用' : (x.can_add ? '可投' : '暂停')}</span></div>
      <div class="nspx-legamt${usedUp ? ' used' : ''}">${nf(x.amount_pct, 3)}<span>%</span></div>
    </div>
    <div class="nspx-legreason">${esc(x.reason || '')}</div>
    ${x.can_add && x.tranches > 1 ? `<div class="nspx-legsplit">拆 ${x.tranches} 笔投放，每笔 ${nf(x.per_tranche_pct, 3)}%（受单笔 ≤${nf((DATA.decision.budget || {}).single_trade_cap_pct, 2)}% 约束）</div>` : ''}
    <div class="nspx-leggrid">${rows
      .map(([k, v, c]) => `<div class="nspx-cell"><div class="k">${esc(k)}</div><div class="v ${c}">${v}</div></div>`)
      .join('')}</div>
    <div class="nspx-legfoot">
      指数 ${nf(x.index_close, 0)}${x.index_estimated ? '<i class="nspx-dim">（ETF 递推估算）</i>' : ''}
      <i class="nspx-dim"> · ${esc(x.index_date || '')}</i>
      ${tech.ok ? `<br>技术：EMA21 ${nf(tech.ema21)} / EMA55 ${nf(tech.ema55)} · RSI14 ${nf(tech.rsi14, 1)} · ATR ${nf(tech.atr_pct)}% · HV20 ${nf(tech.hv20, 1)}%
      <br>门 D：<b class="${tech.gateD_blocked ? 'down' : 'up'}">${tech.gateD_blocked ? '否决' : '放行'}</b> <i class="nspx-dim">${esc(tech.gateD_reason || '')}</i>` : ''}
    </div>
  </div>`;
}

function legsHTML() {
  const d = DATA.decision || {};
  return `<div class="nspx-sec"><h3>两条腿</h3>
    <div class="nspx-legs">${(d.legs || []).map(legCardHTML).join('')}</div></div>`;
}

/* ERP 坐标轴：一眼看出离下一档还有多远 */
function erpAxisHTML() {
  const d = DATA.decision || {};
  const th = d.thresholds || {};
  const legs = DATA.legs || {};
  const LO = -2.6, HI = 1.1;                    // 坐标域，覆盖当前读数到 L3
  const pos = (v) => Math.max(0, Math.min(100, ((Number(v) - LO) / (HI - LO)) * 100));
  const marks = [['L1', th.L1], ['L2', th.L2], ['L3', th.L3]];
  const needles = [
    { name: 'SPX', v: legs.spx && legs.spx.erp_pp, tone: 'a' },
    { name: 'NDX', v: legs.ndx && legs.ndx.erp_pp, tone: 'b' },
  ];
  const zones = [
    { label: 'L0 区（只定投）', from: LO, to: Number(th.L1), tone: 'z0' },
    { label: 'L1 区', from: Number(th.L1), to: Number(th.L2), tone: 'z1' },
    { label: 'L2 区', from: Number(th.L2), to: Number(th.L3), tone: 'z2' },
    { label: 'L3 区', from: Number(th.L3), to: HI, tone: 'z3' },
  ].filter((z) => Number.isFinite(z.from) && Number.isFinite(z.to));

  return `<div class="nspx-sec"><h3>ERP 位置（越往右越便宜）</h3>
    <div class="nspx-hint">ERP = 盈利收益率 − 10Y 美债。这是全场唯一的估值锚，阶梯只认它。</div>
    <div class="nspx-axis">
      <div class="nspx-axisbar">
        ${zones.map((z) => `<div class="nspx-zone ${z.tone}" style="left:${pos(z.from)}%;width:${pos(z.to) - pos(z.from)}%"></div>`).join('')}
        ${marks.map(([k, v]) => `<div class="nspx-mark" style="left:${pos(v)}%"><i></i><span>${k} ${nf(v, 2)}</span></div>`).join('')}
        ${needles.map((n) => Number.isFinite(Number(n.v)) ? `<div class="nspx-needle ${n.tone}" style="left:${pos(n.v)}%"><b>${n.name}</b><span>${nf(n.v, 2)}</span></div>` : '').join('')}
      </div>
      <div class="nspx-axisscale"><span>${LO}pp</span><span>0</span><span>${HI}pp</span></div>
    </div>
    <div class="nspx-dist">
      ${[['SPX', legs.spx], ['NDX', legs.ndx]].map(([n, l]) => {
        if (!l || !l.ok) return '';
        return `<div class="nspx-distrow">
          <div class="nspx-distname">${n}</div>
          <div class="nspx-distcells">
            ${[['L1', l.need_drop_L1_pct, th.L1], ['L2', l.need_drop_L2_pct, th.L2], ['L3', l.need_drop_L3_pct, th.L3]]
              .map(([k, drow, tv]) => `<div class="nspx-dcell">
                <div class="k">到 ${k}（ERP ≥ ${nf(tv, 2)}pp）</div>
                <div class="v ${Number(drow) > 0 ? 'flat' : 'up'}">${Number(drow) > 0 ? '再跌 ' + pct(Number(drow)) : '已达标'}</div>
              </div>`).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

/* 迷你 SVG 折线：给 history 里的一条数值序列 */
function sparkHTML(points, opt = {}) {
  const vals = points.map((p) => p.v).filter((v) => Number.isFinite(v));
  if (vals.length < 2) return '<div class="nspx-dim">样本不足</div>';
  const W = opt.w || 620, H = opt.h || 90, PAD = 8;
  const xs = points.map((p, i) => PAD + (i * (W - PAD * 2)) / Math.max(1, points.length - 1));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (opt.zeroLine) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const pad2 = (hi - lo) * 0.12;
  lo -= pad2; hi += pad2;
  const y = (v) => PAD + (H - PAD * 2) * (1 - (v - lo) / (hi - lo));
  const line = (pts, color, width) =>
    `<polyline fill="none" stroke="${color}" stroke-width="${width || 1.8}" stroke-linejoin="round" stroke-linecap="round"
      points="${pts.map((p) => `${p.x.toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}"/>`;

  const series = Array.isArray(opt.series) ? opt.series : [{ key: 'v', color: '#2f6feb' }];
  const zeroY = opt.zeroLine ? y(0) : null;
  return `<svg viewBox="0 0 ${W} ${H}" class="nspx-spark" preserveAspectRatio="none">
    ${zeroY != null ? `<line x1="${PAD}" x2="${W - PAD}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="#c9ced6" stroke-width="1" stroke-dasharray="4 3"/>` : ''}
    ${series.map((s) => line(points.map((p, i) => ({ x: xs[i], v: Number(p[s.key]) })).filter((p) => Number.isFinite(p.v)), s.color, s.width)).join('')}
  </svg>`;
}

function erpCurveHTML() {
  const h = (DATA.history || []).slice().reverse();
  const pts = h.filter((r) => r.spx_erp != null || r.ndx_erp != null).map((r) => ({ spx: Number(r.spx_erp), ndx: Number(r.ndx_erp) }));
  if (pts.length < 2) return '';
  return `<div class="nspx-sec"><h3>ERP 历史曲线</h3>
    <div class="nspx-hint">共 ${pts.length} 次判定。上方虚线是 0 轴 —— 两条线都在 0 下方，说明股票相对债券始终不便宜。</div>
    ${sparkHTML(pts, { zeroLine: true, h: 110, series: [{ key: 'spx', color: '#d93a3a' }, { key: 'ndx', color: '#2f6feb' }] })}
    <div class="nspx-legend"><span class="nspx-li" style="--c:#d93a3a">SPX ERP</span><span class="nspx-li" style="--c:#2f6feb">NDX ERP</span></div>
  </div>`;
}

function volCurveHTML() {
  const mk = (key, name, color) => {
    const arr = DATA[`${key}_series`] || [];
    if (arr.length < 2) return '';
    return `<div class="nspx-curveblk">
      <div class="nspx-curvetitle">${name}<span>${esc(arr[arr.length - 1].date)} 收盘 ${nf(arr[arr.length - 1].close)}</span></div>
      ${sparkHTML(arr.map((r) => ({ v: Number(r.close) })), { h: 70, series: [{ key: 'v', color }] })}
    </div>`;
  };
  const a = mk('vix', 'VIX（标普波动率）', '#d93a3a');
  const b = mk('vxn', 'VXN（纳指波动率）', '#2f6feb');
  if (!a && !b) return '';
  return `<div class="nspx-sec"><h3>波动率 60 日</h3>
    <div class="nspx-hint">终裁 T10：波动率与情绪模块 <b>权重 0%</b>，只观察不打 —— 它们彼此相关性 0.85–0.95，当成三个独立因子会把风险低估 1.66 倍。</div>
    <div class="nspx-curves">${a}${b}</div></div>`;
}

function factorsHTML() {
  const r = DATA.rates || {}, v = DATA.vol || {}, f = DATA.fng || {}, x = DATA.fx || {}, t = DATA.tips || {};
  const b = DATA.base || {};
  const cells = [
    ['10Y 美债', `${nf(r.y10)}%`, 'flat'],
    ['2Y 美债', `${nf(r.y2)}%`, 'flat'],
    ['3M 美债', `${nf(r.y3m)}%`, 'flat'],
    ['期限利差 10Y−2Y', r.term_spread_bp == null ? '—' : `${nf(r.term_spread_bp, 0)}bp`, Number(r.term_spread_bp) > 0 ? 'up' : 'down'],
    ['TIPS 实际利率', `${nf(t.y10)}%`, Number(t.y10) >= 2.75 ? 'down' : Number(t.y10) >= 2.6 ? 'warn' : 'up'],
    ['VIX', nf(v.vix), 'flat'],
    ['VXN', nf(v.vxn), 'flat'],
    ['F&G 情绪', `${nf(f.score)}（${esc(f.rating || '')}）`, Number(f.score) < 40 ? 'warn' : 'flat'],
    ['USDCNY', nf(x.usdcny, 4), Number(x.usdcny) < 6.6 ? 'down' : 'flat'],
    ['QQQ/SPY', nf((DATA.ratio || {}).ratio, 4), (DATA.ratio || {}).below_gate ? 'down' : 'flat'],
  ];
  return `<div class="nspx-sec"><h3>因子快照</h3>
    <div class="nspx-hint">利率 ${esc(r.date || '')} · TIPS ${esc(t.date || '')} · VIX/VXN ${esc(v.vix_date || '')} · 汇率 ${esc(x.date || '')} · 基准 PE ${esc(b.date || '')}（SPX ${nf(b.spx_pe)} / NDX ${nf(b.ndx_pe)}）</div>
    <div class="nspx-grid">${cells
      .map(([k, val, c]) => `<div class="nspx-cell"><div class="k">${esc(k)}</div><div class="v ${c}">${val}</div></div>`)
      .join('')}</div>
    <div class="nspx-hint2">除 ERP 与门 D 外的因子均为<b>观察项，权重 0%</b>（终裁 T10）。它们的作用是在极端读数时给出背景，不参与扳机。</div>
  </div>`;
}

function gateDHTML() {
  const t = DATA.tech || {};
  const rows = [['spy', 'SPY'], ['qqq', 'QQQ']].map(([k, name]) => [name, t[k]]).filter(([, x]) => x && x.ok);
  if (!rows.length) return '';
  const head = ['腿', '收盘', 'EMA21', 'EMA55', 'ATR%', 'RSI14', 'ADX14', '%B', 'z(20)', 'HV20', '距EMA55', '门 D'];
  const body = rows
    .map(([name, x]) => `<tr>
      <td><b>${name}</b></td>
      <td>${nf(x.close)}</td>
      <td>${nf(x.ema21)}</td>
      <td>${nf(x.ema55)}</td>
      <td>${nf(x.atr_pct)}</td>
      <td>${nf(x.rsi14, 1)}</td>
      <td>${nf(x.adx14, 1)}</td>
      <td class="${Number(x.bb_pct_b) > 100 ? 'down' : 'flat'}">${nf(x.bb_pct_b, 1)}</td>
      <td class="${Math.abs(Number(x.z20)) > 2 ? 'down' : 'flat'}">${nf(x.z20)}</td>
      <td>${nf(x.hv20, 1)}</td>
      <td>${nf(x.dist_ema55_atr)}×ATR</td>
      <td class="${x.gateD_blocked ? 'down' : 'up'}">${x.gateD_blocked ? '否决' : '放行'}</td>
    </tr>`)
    .join('');
  const rr = rows.find(([, x]) => x.gateD_blocked);
  return `<div class="nspx-sec"><h3>门 D（技术执行门）</h3>
    <div class="nspx-hint">触发条件：收盘冲出布林上轨（%B&gt;100）且偏离均值 &gt;2σ；或 ADX&lt;15 无趋势却已高出 EMA55 三倍 ATR。命中 → <b>当日该腿不执行</b>（延迟不是取消）。
      ${rr ? `<br>当前 <b class="down">${rr[0]} 被否决</b>：${esc(rr[1].gateD_reason || '')}` : '<br>当前两腿均放行。'}</div>
    <div class="nspx-twrap"><table class="nspx-table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>
  </div>`;
}

function circuitsHTML() {
  const c = DATA.circuits || { items: [] };
  const tone = (s) => (s === 'triggered' ? 'down' : s === 'warn' ? 'warn' : s === 'disabled' ? 'flat' : 'up');
  const label = (s) => ({ triggered: '触发', warn: '缓冲', disabled: '未监控', ok: '正常' }[s] || s);
  return `<div class="nspx-sec"><h3>熔断 <span class="nspx-dim">（监控 ${c.monitored}/${c.total} 条）</span></h3>
    <div class="nspx-cb">${(c.items || [])
      .map((i) => `<div class="nspx-cbitem ${tone(i.state)}">
        <div class="nspx-cbtop"><b>${esc(i.id)}</b><span class="nspx-badge ${tone(i.state)}">${label(i.state)}</span></div>
        <div class="nspx-cbname">${esc(i.name)}</div>
        <div class="nspx-cbnote">${esc(i.note)}</div>
      </div>`)
      .join('')}</div>
  </div>`;
}

function sourcesHTML() {
  const s = DATA.sources || [];
  if (!s.length) return '';
  const body = s
    .map((x) => `<tr>
      <td>${esc(x.name)}</td>
      <td>${esc(x.date || '—')}</td>
      <td>${esc(x.field)}</td>
      <td class="${x.lags ? (x.critical ? 'down' : 'warn') : 'up'}">${x.lags ? (x.critical ? '落后（关键）' : '落后') : '同步'}</td>
    </tr>`)
    .join('');
  return `<div class="nspx-sec"><h3>数据源龄</h3>
    <div class="nspx-hint">各源发布节奏不同：财政部最快，<b>CBOE 公开 CSV 实测会晚 1~5 个交易日</b>。标「落后」的数字不是实时读数，别拿它当今天的。</div>
    <div class="nspx-twrap"><table class="nspx-table">
      <thead><tr><th>数据源</th><th>数据日</th><th>用途</th><th>状态</th></tr></thead>
      <tbody>${body}</tbody></table></div></div>`;
}

function historyHTML() {
  const h = DATA.history || [];
  if (!h.length) return '';
  const body = h
    .slice(0, 30)
    .map((r) => `<tr>
      <td>${esc(String(r.t || '').slice(5, 16))}</td>
      <td class="${r.can ? 'up' : 'flat'}">${esc(r.action || '')}</td>
      <td>${pp(Number(r.spx_erp))}</td>
      <td>${pp(Number(r.ndx_erp))}</td>
      <td>${r.spx_tier || '—'}</td>
      <td>${r.ndx_tier || '—'}</td>
      <td>${nf(r.y10)}%</td>
      <td>${nf(r.vix)}</td>
      <td>${nf(r.fng)}</td>
    </tr>`)
    .join('');
  return `<div class="nspx-sec"><h3>判定历史</h3>
    <div class="nspx-hint">每次 cron 跑完追加一行。用它反查"当时为什么没加"，比事后回忆靠谱。</div>
    <div class="nspx-twrap"><table class="nspx-table">
      <thead><tr><th>时间</th><th>判定</th><th>SPX ERP</th><th>NDX ERP</th><th>SPX层</th><th>NDX层</th><th>10Y</th><th>VIX</th><th>F&G</th></tr></thead>
      <tbody>${body}</tbody></table></div></div>`;
}

function noteHTML() {
  // 注意：本函数在 shell() 里就会被调用一次，那时 DATA 还是 null（数据要等 fetch 回来）。
  // 所以这里不能裸读 DATA.*，必须兜底 —— 否则首屏直接抛 TypeError 整块面板白屏。
  // （这个坑是冒烟测试抓出来的：mock window 后真实 import 一遍就复现。）
  const d = (DATA && DATA.decision) || {};
  const bg = d.budget || {};
  return `<div class="nspx-note">
    <b>这套规则是怎么来的</b>
    <ul>
      <li><b>ERP 是唯一的锚</b>：ERP = 1/PE − 10Y 美债。<b>gate 与 sizer 是分工的</b> —— 估值/基本面只决定"能不能加"，情绪/波动率本该决定"加多少"，
          但终裁 T10 把它们<b>硬冻结 0%</b>：VIX / VXN / F&amp;G 三者相关性 0.85–0.95，当成三个独立因子会让风险被低估 <b>1.66 倍</b>。</li>
      <li><b>"跌了 ≠ 便宜"</b>：ERP 的分子（EPS）和分母（10Y）会同时动。SPX 跌 10% 若伴随 EPS 下修 15%，触发时 ERP 反而更差。所以门槛只认 ERP，不认跌幅本身。</li>
      <li><b>跌幅与盈利收益率是非线性关系</b>：正确公式 <code>d = 1 − EY₀/(ERP门槛 + 10Y)</code>。线性近似会低估 3.2–5.9 个百分点。</li>
      <li><b>PE 怎么来的</b>：指数级 TTM PE 是付费数据，免费源全部试过（Yahoo quoteSummary 已废弃、Nasdaq 不返回、multpl / stockanalysis 抓不到、FRED 需 key）。
          故按你拍板的<b>基准 PE + 价格递推</b>：每季度填一次基准，季度内假设 EPS 不变，用指数点位日推盈利收益率。超过 90 天没重填会黄字告警。</li>
      <li><b>金额</b>：弹药池 ${nf(bg.P_pct)}% 总权益，拆成 L0 通道 ${nf(bg.P_L0_pct)}% 与触发通道 ${nf(bg.P_TRIG_pct)}%，互不挪用。
          触发层金额 ${nf((bg.layer_amount_pct || {}).L1)} / ${nf((bg.layer_amount_pct || {}).L2)} / ${nf((bg.layer_amount_pct || {}).L3)}%，
          按 SPY:QQQ ${Math.round((bg.spy_weight || 0.8) * 100)}:${Math.round((bg.qqq_weight || 0.2) * 100)} 拆腿，再受<b>单笔 ≤${nf(bg.single_trade_cap_pct)}%</b> 约束自动分笔。
          NDX 腿另有累计 ≤${nf(bg.ndx_cap_pct)}% 上限。</li>
      <li><b>数据来源</b>：10Y/2Y/3M 与 TIPS 实际收益率取自<b>美国财政部官方日度曲线</b>；VIX/VXN 取自 <b>CBOE 官方 CSV</b>（比第三方准，实测纠出了错误读数）；
          F&amp;G 取自 CNN（需伪造 Referer）；点位与 ETF 取自 Yahoo。<b>全部免费、无需 key。</b></li>
      <li><b>已知未闭合项</b>：① 底仓 QQQ/SPY 的真实构成比例不可得（当前按估值更贵取 ${Math.round((bg.spy_weight || 0.8) * 100)}:${Math.round((bg.qqq_weight || 0.2) * 100)} 的保守口径）；
          ② L0 月度扣款有 0.15%（P_L0÷12）与 0.20%（2.5%P）两种读法，当前取前者；③ CB-3 盈利质量、DLY-1 QDII 额度、DLY-2 T+2 漂移无自动源，需人工。</li>
      <li>这是<b>仅针对增量资金</b>的加仓系统，不含底仓处置。底仓按终裁为 <b>HOLD</b>。</li>
    </ul>
  </div>`;
}

/* ---------------- 渲染 / 取数 ---------------- */

function shell(panel) {
  panel.innerHTML = `
    <div class="panel-head">
      <h2>${esc('NASDAQ & S&P 决策')}</h2>
      <span class="desc">NDX / SPX 多因子加仓决策 · ERP 阶梯 + 门D + 熔断</span>
      <div class="grow"></div>
      <button class="ghost" id="nspx-refresh">刷新</button>
    </div>
    <div id="nspx-body"><div class="empty">正在读取最新判定…</div></div>
    <div class="nspx-foot" id="nspx-foot"></div>
    <div id="nspx-note"></div>`;

  panel.querySelector('#nspx-refresh').onclick = () => load(panel, true);
}

function render(panel) {
  const body = panel.querySelector('#nspx-body');
  const foot = panel.querySelector('#nspx-foot');
  if (!body) return;

  if (!DATA || DATA.error) {
    body.innerHTML = `<div class="empty">${esc((DATA && DATA.error) || '暂无数据')}</div>`;
    if (foot) foot.textContent = '';
    return;
  }

  body.innerHTML =
    verdictHTML() +
    l0ToggleHTML() +
    legsHTML() +
    erpAxisHTML() +
    erpCurveHTML() +
    volCurveHTML() +
    factorsHTML() +
    gateDHTML() +
    circuitsHTML() +
    sourcesHTML() +
    historyHTML();

  wireL0(panel);   // innerHTML 刚重画过，勾框的事件要重新挂

  // 说明区里带了金额参数，要等数据回来再渲染，否则永远显示「—」
  const note = panel.querySelector('#nspx-note');
  if (note) note.innerHTML = noteHTML();

  if (foot) {
    const age = ageMinutes(DATA.generated_at);
    const stale = age != null && age > 26 * 60;   // 一天没跑就要提醒
    const f = DATA.freshness || {};
    foot.innerHTML =
      `判定时间 ${esc(DATA.generated_at || '')}（北京时间，${esc(ageText(DATA.generated_at))}）` +
      `<b class="${stale ? 'down' : ''}">${stale ? ' ⚠ 超过 26 小时没更新，检查 cron' : ''}</b>` +
      `<br>基准 PE 锚定 ${esc(f.base_date || '')}（已 ${esc(String(f.base_age_days ?? '—'))} 天，${f.stale ? '<b class="down">已过期</b>' : '正常'}）` +
      `<br>数据源：美国财政部 / CBOE / CNN / Yahoo · 判定逻辑只在 <code>/opt/ndxspx/daily_decide.py</code> 一份`;
  }
}

async function load(panel, force) {
  const btn = panel.querySelector('#nspx-refresh');
  const body = panel.querySelector('#nspx-body');
  if (btn) {
    btn.disabled = true;
    if (force) btn.textContent = '重跑中…';
  }
  // 真刷新要抓 5 个上游，约 25~35 秒，先把话说清楚，别让人以为卡死
  if (force && DATA && !DATA.error && body) {
    const tip = document.createElement('div');
    tip.className = 'nspx-refresh-tip';
    tip.id = 'nspx-tip';
    tip.textContent = '正在让服务器重跑判定（抓财政部 / CBOE / CNN / Yahoo），约 25~35 秒…';
    body.parentNode.insertBefore(tip, body);
  }
  try {
    const r = await fetch('/api/ndxspx' + (force ? '?refresh=1' : ''));
    if (r.status === 401) {
      location.href = '/login.html';
      return;
    }
    const j = await r.json();
    DATA = j;
    if (l0Key() !== L0KEY) await syncL0();   // 页面挂着跨月了，开关要重新拉
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
    const tip = panel.querySelector('#nspx-tip');
    if (tip) tip.remove();
    if (btn) {
      btn.disabled = false;
      btn.textContent = '刷新';
    }
  }
}

function schedule(panel) {
  clearInterval(poller);
  // cron 一天一次，10 分钟看一眼足够（只读盘，不重跑 Python，很轻）
  poller = setInterval(() => {
    if (document.hidden) return;
    const p = document.querySelector('.panel[data-id="ndxspx"]');
    if (!p || !p.classList.contains('active')) return;
    load(p, false);
  }, 600_000);
}

window.Billboard.register('ndxspx', {
  async mount(ctx) {
    const { panel } = ctx;
    shell(panel);
    await syncL0();          // 先取开关状态，免得首屏先闪一下「未投」再跳成「已投」
    await load(panel, false);
    schedule(panel);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      const p = document.querySelector('.panel[data-id="ndxspx"]');
      if (!p || !p.classList.contains('active')) return;
      load(p, false);
    });
  },
});
