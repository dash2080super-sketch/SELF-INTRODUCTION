const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const html = await (await fetch('https://naaim.org/programs/naaim-exposure-index/', { headers: { 'User-Agent': UA } })).text();
console.log('len', html.length);

// 找所有 .json / api 链接
console.log('\n-- json/api links --');
console.log([...html.matchAll(/["']([^"']*\.(?:json|csv)[^"']*)["']/gi)].map((m) => m[1]).slice(0, 20));

// 找 chart 数据源
console.log('\n-- data-* attrs / fusioncharts / highcharts --');
console.log([...html.matchAll(/(fusioncharts|highcharts|chartData|dataSource|dataSourceString|\.setJSONData)/gi)].slice(0, 10).map((m) => m[0]));

// 关键词上下文
for (const kw of ['Exposure Index', 'latest', 'Last Week', 'Current']) {
  const i = html.indexOf(kw);
  console.log(`\n-- "${kw}" @${i} --`);
  if (i > 0) console.log(html.slice(Math.max(0, i - 300), i + 600).replace(/\s+/g, ' '));
}
