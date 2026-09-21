#!/usr/bin/env bash
# 配 HTTPS（需 root，需先把域名解析到本机 IP）
#   bash scripts/setup-caddy.sh board.example.com            # 用 443
#   bash scripts/setup-caddy.sh board.example.com 8443       # 443 已被占用时换端口
set -euo pipefail
DOMAIN="${1:-}"
PORT="${2:-443}"
if [ -z "$DOMAIN" ]; then
  echo "用法: bash scripts/setup-caddy.sh 你的域名 [端口，默认 443]"
  exit 1
fi
if [ "$PORT" = "443" ]; then SITE="$DOMAIN"; else SITE="$DOMAIN:$PORT"; fi
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

echo "==> 安装 Caddy"
apt-get update -qq
apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
apt-get update -qq
apt-get install -y -qq caddy

echo "==> 写 Caddyfile"
cat > /etc/caddy/Caddyfile <<EOF
$SITE {
    reverse_proxy 127.0.0.1:3000
    encode gzip
}
EOF
systemctl enable --now caddy
systemctl reload caddy

echo
echo "=============================================="
echo " 完成。放行端口后访问 https://$SITE"
echo " 需要的放行： 80/tcp（证书签发）、${PORT}/tcp"
echo "   ufw allow 80/tcp && ufw allow ${PORT}/tcp"
echo " （若用 DO Cloud Firewall，也在面板里加这两条）"
echo "=============================================="
