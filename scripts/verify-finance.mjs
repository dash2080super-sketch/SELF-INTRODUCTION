// 校验 /api/finance：分区数、缺数据、分级元信息、实时档读数
const CK = process.env.CK || '';
const r = await fetch('http://127.0.0.1:3000/api/finance', { headers: { Cookie: `bb_session=${CK}` } });
if (!r.ok) {
  console.log('HTTP', r.status);
  process.exit(1);
}
const j = await r.json();
if (j.error) {
  console.log('ERR', j.error);
  process.exit(1);
}

const items = j.zones.flatMap((z) => z.items);
console.log('分区', j.zones.length, ' 指标', items.length);
console.log('meta:', JSON.stringify(j.meta));

const miss = items.filter((i) => !i.manual && Object.keys(i.legs).length === 0);
console.log('缺数据:', miss.length ? miss.map((i) => i.name).join(', ') : '0 个');

console.log('\n--- 实时档（fast）---');
for (const i of items.filter((x) => x.tier === 'fast')) {
  const legs = Object.entries(i.legs).map(([k, v]) => `${k}=${v.price}`).join('  ');
  const age = i.age == null ? '?' : Math.round(i.age / 1000) + 's';
  console.log(' ' + String(i.name).padEnd(12) + legs + '   (' + age + ' 前)');
}

console.log('\n--- 常规档抽样 ---');
for (const i of items.filter((x) => x.tier === 'slow').slice(0, 6)) {
  const legs = Object.entries(i.legs).map(([k, v]) => `${k}=${v.price}`).join('  ');
  const age = i.age == null ? '?' : Math.round(i.age / 1000) + 's';
  console.log(' ' + String(i.name).padEnd(14) + legs + '   (' + age + ' 前)');
}

const manual = items.filter((i) => i.manual);
console.log('\n手动项:', manual.map((i) => i.name + '=' + (i.manualValue?.value ?? '未录入')).join(', '));
