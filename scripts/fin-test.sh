#!/bin/bash
# 在 VPS 上测 /api/finance：登录拿 cookie -> 拉看板 -> 逐项打印
set -u
PW="${1:-bbTemp989003}"
rm -f /tmp/ck.txt
curl -s -c /tmp/ck.txt -X POST http://127.0.0.1:3000/api/login \
  -H 'Content-Type: application/json' -d "{\"password\":\"$PW\"}" > /tmp/login.txt
echo "login: $(cat /tmp/login.txt)"
curl -s -b /tmp/ck.txt http://127.0.0.1:3000/api/finance > /tmp/fin.json
echo "bytes: $(wc -c < /tmp/fin.json)"
node -e '
const j = JSON.parse(require("fs").readFileSync("/tmp/fin.json","utf8"));
if (j.error) { console.log("ERROR:", j.error); process.exit(1); }
console.log("at:", j.at, "cached:", j.cached);
let miss = 0, total = 0;
for (const z of j.zones) {
  console.log("\n== " + z.name + " ==");
  for (const it of z.items) {
    const legs = Object.entries(it.legs || {});
    total++;
    if (!legs.length && !it.manual) { miss++; console.log("  ✗ " + it.name + " (无数据)"); continue; }
    if (it.manual) { console.log("  · " + it.name + " [手动] " + (it.manualValue?.value ?? "—")); continue; }
    console.log("  ✓ " + it.name + ": " + legs.map(([k,v]) => `${k}=${v.price}(${v.chgPct==null?"n/a":v.chgPct.toFixed(2)+"%"})[${v.src}]`).join("  "));
  }
}
console.log("\n无数据指标: " + miss + " / " + total);
'
