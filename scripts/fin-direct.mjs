import Database from '/opt/billboard/node_modules/better-sqlite3/lib/index.js';
import { getFinance } from '/opt/billboard/src/finance-data.js';

const db = new Database('/opt/billboard/data/billboard.db', { readonly: true });
const t0 = Date.now();
const j = await getFinance(db, true);
console.log('耗时:', Date.now() - t0, 'ms   at:', j.at);

let miss = 0;
let total = 0;
for (const z of j.zones) {
  console.log('\n== ' + z.name + ' ==');
  for (const it of z.items) {
    total++;
    if (it.manual) {
      console.log('  · ' + it.name + ' [手动] ' + (it.manualValue?.value ?? '—'));
      continue;
    }
    const legs = Object.entries(it.legs || {});
    if (!legs.length) {
      miss++;
      console.log('  X ' + it.name + '  <-- 无数据');
      continue;
    }
    console.log(
      '  v ' + it.name.padEnd(14) +
      legs.map(([k, v]) => `${k}=${v.price} ${v.chgPct == null ? '(no chg)' : (v.chgPct > 0 ? '+' : '') + v.chgPct.toFixed(2) + '%'} [${v.src}]`).join('   ')
    );
  }
}
console.log('\n缺数据: ' + miss + ' / ' + total);
