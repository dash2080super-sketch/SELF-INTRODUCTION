/**
 * 红利引擎独立自测：不开服务器、不碰数据库，直接跑 evaluate()。
 * 用法：
 *   node scripts/test-dividend.mjs                # 默认测 600036
 *   node scripts/test-dividend.mjs 601088 600900  # 指定代码
 * 目的：验证股息率 / 3×国债锚 / 网格目标价 / 布林带位置 是否算对。
 */
import { evaluate, fetchAnchor, stats } from '../src/dividend-data.js';
import { STRATEGY } from '../src/dividend-catalog.js';

const codes = process.argv.slice(2).length ? process.argv.slice(2) : ['600036'];

console.log('=== 国债锚 ===');
const anchor = await fetchAnchor();
console.log(anchor ? `10Y = ${anchor.y10}%  日期 ${anchor.date}  来源 ${anchor.src}` : '❌ 取不到');

if (anchor) {
  console.log(
    `→ 策略门槛：${STRATEGY.anchorMultiple} × ${anchor.y10} = ${(anchor.y10 * STRATEGY.anchorMultiple).toFixed(3)}%`
  );
}

for (const code of codes) {
  console.log(`\n=== ${code} ===`);
  try {
    const it = await evaluate(code);
    const p = (k, v) => console.log(`  ${k.padEnd(18, ' ')} ${v}`);

    p('名称', it.name);
    p('现价', it.price + '  ' + (it.chgPct > 0 ? '+' : '') + it.chgPct + '%');
    p('PE / PB / 市值', `${it.pe} / ${it.pb} / ${it.mcapYi} 亿`);
    p('每股分红', it.dps == null ? '—' : `${it.dps} 元（${it.fiscal?.year} 财年，完整=${it.fiscal?.complete}）`);
    if (it.fiscal?.parts?.length) {
      p('分红构成', it.fiscal.parts.map((x) => `${x.period} ${x.perShare}`).join(' + '));
    }
    p('当前股息率', it.yieldNow == null ? '—' : `${it.yieldNow}%`);
    p('3× 锚门槛', it.anchor3x == null ? '—' : `${it.anchor3x}%`);
    p('估值条件', it.valOk === null ? '—' : it.valOk ? '✅ 达标' : '❌ 未达标');
    p('3× 锚买点价', it.target3 == null ? '—' : `¥${it.target3}`);
    p('现价距买点', it.gapToTargetPct == null ? '—' : `${it.gapToTargetPct}%`);

    console.log('  --- 股息率网格 ---');
    for (const g of it.grid || []) {
      console.log(
        `    ${g.level.toFixed(1)}×  收益率门槛 ${String(g.yieldPct).padEnd(6)} 目标价 ¥${String(g.price).padEnd(9)} ${
          g.hit ? '✅ 现价已达标' : `还差 ${Math.abs(g.gapPct)}%`
        }`
      );
    }

    console.log('  --- 布林带位置（20日/2σ）---');
    for (const k of ['day', 'week', 'month']) {
      const b = it.boll?.[k];
      const t = it.tech?.[k];
      console.log(
        `    ${k.padEnd(6)} 上轨 ${b?.upper ?? '—'}  中轨 ${b?.mid ?? '—'}  下轨 ${b?.lower ?? '—'}` +
          `  距下轨 ${t?.pct == null ? '—' : t.pct + '%'}  → ${t?.state}`
      );
    }

    console.log('  --- 质量检测 ---');
    for (const c of it.quality?.checks || []) {
      console.log(`    ${c.ok ? '✅' : '❌'} ${c.name.padEnd(14)} ${c.detail}`);
    }

    console.log(`  >>> 信号：${it.signal.label} —— ${it.signal.hint}`);
    if (it.missing?.length) console.log(`  ⚠ 缺失数据：${it.missing.join(' / ')}`);
  } catch (e) {
    console.log('  ❌ 失败：' + e.message);
    console.log(e.stack?.split('\n').slice(0, 4).join('\n'));
  }
}

console.log('\n=== 开销 ===');
console.log(JSON.stringify(stats, null, 1));
