// 给 finance-data.js 的 compose() 加"派生比价"支持：ratio 指标把两条腿合成一个展示腿。
import fs from 'node:fs';

const FILE = 'src/finance-data.js';
const LINE = 369;
const EXPECT = 'const tier = tierOf(it);';

const BLOCK = [
  '      // 派生比价：把两条腿合成一个"展示腿"（分子 ÷ 分母 × scale）。',
  '      // 涨跌幅用两边各自涨跌幅相减近似 —— 一阶就够精确，日内 <1% 的波动下误差可忽略。',
  '      // 取不到分母时什么都不做，自然退回显示原始两条腿。',
  '      if (it.ratio) {',
  '        const num = legs[it.ratio.num];',
  '        const den = legs[it.ratio.den];',
  '        if (num && den && num.price != null && den.price) {',
  '          const scale = it.ratio.scale || 1;',
  '          const price = (num.price / den.price) * scale;',
  '          const chgPct = num.chgPct != null && den.chgPct != null ? num.chgPct - den.chgPct : null;',
  '          const prev = chgPct != null && chgPct !== -100 ? price / (1 + chgPct / 100) : null;',
  '          for (const k of Object.keys(legs)) delete legs[k];',
  "          legs[it.ratio.label || '比值'] = {",
  '            price,',
  '            chg: prev != null ? price - prev : null,',
  '            chgPct,',
  '            name: it.en || it.name,',
  '            time: num.time || null,',
  "            src: 'derived',",
  '            at: Math.max(num.at || 0, den.at || 0),',
  '          };',
  '        }',
  '      }',
  '',
];

const lines = fs.readFileSync(FILE, 'utf8').split('\n');
if (!lines[LINE - 1].includes(EXPECT)) {
  throw new Error(`第 ${LINE} 行锚点不符\n  期望含: ${EXPECT}\n  实际:   ${lines[LINE - 1]}`);
}
lines.splice(LINE - 1, 0, ...BLOCK);
fs.writeFileSync(FILE, lines.join('\n'), 'utf8');
console.log(`✅ ${FILE} 派生比价已插入（第 ${LINE} 行前，共 ${BLOCK.length} 行），现在 ${lines.length} 行`);
