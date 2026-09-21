#!/usr/bin/env bash
# 在 VPS 上跑一次即可完成安装（需 root）。代码必须已经放在 /opt/billboard。
#   bash scripts/setup-server.sh
set -euo pipefail
APP=/opt/billboard

echo "==> 1/5 检查 Node"
if ! command -v node >/dev/null 2>&1; then
  echo "  未检测到 Node，安装 Node 22…"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
elif [ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 20 ]; then
  echo "  Node 版本过低：$(node -v)，升级到 22…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
echo "  $(node -v) / npm $(npm -v)"

echo "==> 2/5 建运行用户"
id -u billboard >/dev/null 2>&1 || useradd -r -m -d /home/billboard -s /bin/bash billboard

echo "==> 3/5 安装依赖"
cd "$APP"
if [ -f package-lock.json ]; then
  npm ci --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi

echo "==> 4/5 目录权限"
mkdir -p "$APP/data"
chown -R billboard:billboard "$APP"

echo "==> 5/5 systemd 开机自启"
cp "$APP/scripts/billboard.service" /etc/systemd/system/billboard.service
systemctl daemon-reload
systemctl enable --now billboard
sleep 2
if systemctl is-active --quiet billboard; then
  echo "  服务已启动"
else
  echo "  启动失败，最近日志："
  journalctl -u billboard -n 30 --no-pager
  exit 1
fi

echo
echo "=============================================="
echo " 安装完成。最后一步：设置登录密码"
echo "   cd $APP && sudo -u billboard npm run set-password"
echo " 之后访问 http://<服务器IP>:3000"
echo "=============================================="
