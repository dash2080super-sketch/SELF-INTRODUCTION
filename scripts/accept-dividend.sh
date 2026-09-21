#!/bin/bash
# 高股息板块端到端验收
set -e
cd /opt/billboard

# 1) 公网能拿到前端资源
echo "=== 1. 公网资源 ==="
for u in https://vic-jianhua.me/index.html https://vic-jianhua.me/js/modules/dividend.js https://vic-jianhua.me/css/app.css; do
  printf '  %-48s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code} %{size_download}B' "$u")"
done

# 2) 资源版本号确实注入了
echo
echo "=== 2. 资源版本号注入 ==="
curl -s https://vic-jianhua.me/index.html | grep -o "app.css?v=[a-f0-9]*" | head -1
curl -s "https://vic-jianhua.me/js/modules/dividend.js" | head -c 60
echo

# 3) 关注列表增删
echo
echo "=== 3. 关注列表增删（用临时标的 601398 工商银行）==="
node scripts/check-dividend.mjs 2>&1 | grep '^关注'
node - <<'EOF'
import fs from 'node:fs';
import crypto from 'node:crypto';
const secret = fs.readFileSync('/opt/billboard/.env','utf8').match(/^SESSION_SECRET=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const p = Buffer.from(JSON.stringify({u:'verify',exp:Date.now()+600000})).toString('base64url');
const c = `${p}.${crypto.createHmac('sha256',secret).update(p).digest('base64url')}`;
const H = {'Content-Type':'application/json', cookie:`bb_session=${c}`};
const B = 'http://127.0.0.1:3000';

let r = await (await fetch(`${B}/api/dividend/watchlist`, {method:'POST', headers:H, body: JSON.stringify({code:'601398', name:'工商银行', tag:'银行', note:'验收测试'})})).json();
console.log('  添加 601398 ->', JSON.stringify(r));

r = await (await fetch(`${B}/api/dividend/watchlist`, {headers:H})).json();
const row = r.items.find(x => x.code === '601398');
console.log('  列表里找到了:', row ? `id=${row.id} ${row.name} / ${row.tag}` : '❌ 没有');

r = await (await fetch(`${B}/api/dividend/watchlist`, {method:'POST', headers:H, body: JSON.stringify({code:'601398'})})).json();
console.log('  重复添加 ->', JSON.stringify(r), '（应该报"已经在关注列表里"）');

// 加了标的以后完整跑一次，确认新标的能算出信号
const d = await (await fetch(`${B}/api/dividend`, {headers:H})).json();
const it = d.items.find(x => x.code === '601398');
console.log('  601398 评估:', it ? `¥${it.price} 股息率 ${it.yieldNow}% 买点 ¥${it.target3} 距 ${it.gapToTargetPct}% -> ${it.signal.label}` : '❌ 没算出来');
console.log('  关注数:', d.meta.watched, '| 本轮耗时', d.meta.lastCycleMs, 'ms');

r = await (await fetch(`${B}/api/dividend/watchlist/${row.id}`, {method:'DELETE', headers:H})).json();
console.log('  删除 ->', JSON.stringify(r));
r = await (await fetch(`${B}/api/dividend/watchlist`, {headers:H})).json();
console.log('  删完后关注数:', r.items.length, r.items.map(x=>x.code).join(','));
EOF

# 4) 资源占用
echo
echo "=== 4. 资源占用 ==="
echo "  记账内存: $(systemctl show -p MemoryCurrent --value billboard) 字节"
echo "  整机可用: $(free -m | awk '/Mem:/{print $7" MB"}')"
echo "  服务状态: $(systemctl is-active billboard)"
