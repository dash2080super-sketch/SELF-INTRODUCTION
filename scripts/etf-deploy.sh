#!/usr/bin/env bash
# ETF 看板部署/重装脚本（幂等，可重复执行）。
# 作用：拉 ECharts 到静态目录 → 提交代码 → 重启服务 → 用自签 cookie 打一遍接口自测。
# 用法：bash /opt/billboard/scripts/etf-deploy.sh
set -uo pipefail
APP_DIR=/opt/billboard
cd "$APP_DIR"

echo "== 1) 准备 ECharts（本地 vendor，不依赖 CDN） =="
mkdir -p public/etf/vendor
if [ -s public/etf/vendor/echarts.min.js ]; then
  echo "   已存在，跳过下载"
else
  curl -fsSL --max-time 60 -o public/etf/vendor/echarts.min.js \
    https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js \
    && echo "   下载完成" || echo "   下载失败（页面会自动回退到 CDN）"
fi
ls -l public/etf/vendor/echarts.min.js 2>/dev/null | awk '{print "   size:", $5}'

echo "== 2) 提交并推送（deploy.sh 会 git pull，不推的话改动会被冲掉） =="
git config --global --add safe.directory /opt/billboard 2>/dev/null
git add -f server.js src/etf-data.js src/etf-api.js modules/etf.js \
        public/js/modules/etf.js public/etf/index.html scripts/etf-deploy.sh 2>/dev/null
git -c user.name=billboard -c user.email=billboard@local \
    commit -m "feat(etf): ETF/场内标的看板（实时价/溢价率/K线+指标/资金流/基金概况）" \
    >/tmp/etf-commit.log 2>&1 && echo "   已提交" || echo "   （无改动或提交失败，见 /tmp/etf-commit.log）"
git push origin main >/tmp/etf-push.log 2>&1 && echo "   已推送 origin/main" || echo "   PUSH_FAILED（见 /tmp/etf-push.log）"

echo "== 3) 重启服务 =="
systemctl restart billboard
sleep 2
systemctl is-active --quiet billboard && echo "   billboard 运行中" || { echo "   启动失败"; journalctl -u billboard -n 30 --no-pager; exit 1; }

echo "== 4) 接口自测 =="
TOKEN=$(node scripts/mint-cookie.mjs 5 2>/dev/null)
if [ -z "$TOKEN" ]; then echo "   拿不到 cookie，跳过"; exit 0; fi
echo "--- /api/modules 里的 etf ---"
curl -s -H "Cookie: bb_session=$TOKEN" http://127.0.0.1:3000/api/modules \
  | tr ',' '\n' | grep -o '"id":"etf"[^}]*' | head -2
echo "--- /api/etf/quote?code=513850 ---"
curl -s -H "Cookie: bb_session=$TOKEN" "http://127.0.0.1:3000/api/etf/quote?code=513850" | head -c 600
echo
echo "--- /api/etf/snapshot?code=513850 关键字段 ---"
curl -s -H "Cookie: bb_session=$TOKEN" "http://127.0.0.1:3000/api/etf/snapshot?code=513850" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);
const q=j.quote||{},p=j.premium||{},k=j.kline||{};
console.log("ok:",j.ok,"| quote:",q.name,q.code,q.price,q.changePct,q.error||"");
console.log("kline rows:",(k.rows||[]).length,"| premium:",p.premium&&p.premium.toFixed(2),"% 分位",p.percentile&&p.percentile.toFixed(0),"| nav",p.nav,p.asOf,p.error||"");
console.log("flow:",(j.flow||[]).length,"| info keys:",Object.keys(j.info||{}).length);
}catch(e){console.log("解析失败:",s.slice(0,300))}})'
echo "--- 静态页 /etf/index.html ---"
curl -s -o /dev/null -w "   HTTP %{http_code}  size=%{size_download}\n" -H "Cookie: bb_session=$TOKEN" http://127.0.0.1:3000/etf/index.html
curl -s -o /dev/null -w "   echarts HTTP %{http_code}  size=%{size_download}\n" -H "Cookie: bb_session=$TOKEN" http://127.0.0.1:3000/etf/vendor/echarts.min.js
