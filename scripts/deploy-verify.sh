#!/usr/bin/env bash
# 服务器上自检：服务是否活着、能不能登录、能不能读写。
#   bash scripts/deploy-verify.sh '你的登录密码'
# 会在测试结束后删掉它自己造的测试数据。
set -uo pipefail
PW="${1:-}"
BASE="${BASE:-http://127.0.0.1:3000}"
CK=$(mktemp /tmp/bb.XXXXXX)
trap 'rm -f "$CK"' EXIT

echo "=== Billboard 自检 ($BASE) ==="

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/api/health" || echo 000)
if [ "$code" != "200" ]; then
  echo "[FAIL] 服务没响应 (health=$code)。看日志: journalctl -u billboard -n 40 --no-pager"
  exit 1
fi
echo "[OK]   服务活着 (health 200)"

if [ -z "$PW" ]; then
  echo "[SKIP] 未提供密码，跳过登录与读写检查"
  echo "       用法: bash scripts/deploy-verify.sh '你的密码'"
  exit 0
fi

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -X POST \
  -H 'Content-Type: application/json' -d "{\"password\":\"$PW\"}" \
  -c "$CK" "$BASE/api/login")
if [ "$code" != "200" ]; then
  echo "[FAIL] 登录失败 (HTTP $code)。密码不对？还是没设密码？"
  exit 1
fi
echo "[OK]   登录成功，会话 cookie 已拿到"

mods=$(curl -s -b "$CK" --max-time 8 "$BASE/api/modules" | grep -o '"id":"[a-z]*"' | wc -l)
echo "[OK]   模块接口返回 $mods 个分区（应为 5）"

id=$(curl -s -b "$CK" --max-time 8 -X POST -H 'Content-Type: application/json' \
  -d '{"content":"部署自检，可忽略"}' "$BASE/api/m/todos" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
if [ -n "${id:-}" ]; then
  echo "[OK]   写入测试数据成功 (todo id=$id)"
  curl -s -b "$CK" -o /dev/null --max-time 8 -X DELETE "$BASE/api/m/todos/$id"
  echo "[OK]   已删除测试数据"
else
  echo "[FAIL] 写入失败"
  exit 1
fi

echo "=== 全部通过 ==="
