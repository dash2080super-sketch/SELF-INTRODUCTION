#!/usr/bin/env bash
# 在服务器上改登录密码（需 root，会交互式提示输入，不回显）。
#   ssh -t root@<IP> /opt/billboard/scripts/set-login-password.sh
# 已登录的设备不会被踢下线（SESSION_SECRET 保持不变）。
set -euo pipefail
APP=/opt/billboard

cd "$APP"
# 注意：Windows 的 ssh 会把本机 HOME 传进来，必须显式指定，否则 npm/node 会找错目录
su - billboard -c "cd $APP && HOME=/home/billboard node scripts/set-password.js"

systemctl restart billboard
sleep 2
if systemctl is-active --quiet billboard; then
  echo "✅ 密码已更新，服务已重启"
else
  echo "❌ 服务启动失败，看日志： journalctl -u billboard -n 30 --no-pager"
  exit 1
fi
