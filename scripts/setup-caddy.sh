#!/usr/bin/env bash
# 配 HTTPS（需 root，需先把域名解析到本机 IP）
#   bash scripts/setup-caddy.sh board.example.com
set -euo pipefail
DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "用法: bash scripts/setup-caddy.sh 你的域名"
  exit 1
fi

echo "==> 安装 Caddy"
apt-get update -qq
apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
apt-get update -qq
apt-get install -y -qq caddy

echo "==> 写 Caddyfile"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:3000
    encode gzip
}
EOF
systemctl enable --now caddy
systemctl reload caddy

echo
echo "=============================================="
echo " 完成。请确保云防火墙放行 80 / 443 端口，"
echo " 然后访问 https://$DOMAIN"
echo "=============================================="
