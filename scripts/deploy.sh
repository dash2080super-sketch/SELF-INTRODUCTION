#!/usr/bin/env bash
# VPS 上更新代码并重启（如果装了 Caddy 会自动续 HTTPS 证书，不用管）
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/billboard}"

cd "$APP_DIR"
git pull --ff-only || echo "（非 git 目录，跳过 pull）"
npm ci --omit=dev --no-audit --no-fund
sudo systemctl restart billboard
sleep 1
sudo systemctl is-active --quiet billboard && echo "✅ billboard 已重启" || (echo "❌ 启动失败，看日志：sudo journalctl -u billboard -n 50"; exit 1)
