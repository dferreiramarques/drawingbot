#!/usr/bin/env bash
# DrawingBot installer for Raspberry Pi OS Lite (Bookworm or newer, 64-bit recommended).
#
# From the internet (latest published version):
#   curl -fsSL https://dferreiramarques.github.io/drawingbot/pi/install.sh | sudo bash
# From an extracted drawingbot-pi.tar.gz:
#   sudo bash drawingbot/install.sh
#
# Running it again updates DrawingBot and keeps projects and drawingbot.txt.
set -euo pipefail

BASE_URL="${DRAWINGBOT_URL:-https://dferreiramarques.github.io/drawingbot/pi}"
APP_DIR=/opt/drawingbot
DATA_DIR=/var/lib/drawingbot

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\nErro: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "corre o instalador com sudo."
command -v systemctl >/dev/null || fail "é necessário systemd (Raspberry Pi OS)."
command -v nmcli >/dev/null || fail "é necessário NetworkManager: usa Raspberry Pi OS Bookworm ou mais recente."

SRC=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || true)"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/server.mjs" ]; then SRC="$SCRIPT_DIR"; fi
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
if [ -z "$SRC" ]; then
  say "A descarregar o DrawingBot…"
  command -v curl >/dev/null || apt-get install -y curl
  curl -fsSL "$BASE_URL/drawingbot-pi.tar.gz" -o "$TMP/drawingbot-pi.tar.gz" || fail "não foi possível descarregar $BASE_URL/drawingbot-pi.tar.gz"
  tar -xzf "$TMP/drawingbot-pi.tar.gz" -C "$TMP"
  SRC="$TMP/drawingbot"
  [ -f "$SRC/server.mjs" ] || fail "o pacote descarregado está incompleto."
fi

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if ! command -v node >/dev/null || [ "$(node_major)" -lt 18 ]; then
  say "A instalar o Node.js…"
  apt-get update
  apt-get install -y nodejs
fi
[ "$(node_major)" -ge 18 ] || fail "é necessário Node.js 18 ou mais recente."

say "A preparar o utilizador e as pastas…"
id drawingbot >/dev/null 2>&1 || useradd --system --user-group --home-dir "$DATA_DIR" --shell /usr/sbin/nologin drawingbot
usermod -aG dialout drawingbot
mkdir -p "$DATA_DIR/jobs" /etc/drawingbot
chown -R drawingbot:drawingbot "$DATA_DIR"

say "A instalar a aplicação em $APP_DIR…"
rm -rf "$APP_DIR.new" "$APP_DIR.old"
mkdir -p "$APP_DIR.new"
cp -a "$SRC/." "$APP_DIR.new/"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$APP_DIR.old"
mv "$APP_DIR.new" "$APP_DIR"
rm -rf "$APP_DIR.old"
chown -R root:root "$APP_DIR"
install -m 755 "$APP_DIR/apply-config.sh" /usr/local/sbin/drawingbot-apply-config
install -m 644 "$APP_DIR/systemd/drawingbot.service" /etc/systemd/system/drawingbot.service
install -m 644 "$APP_DIR/systemd/drawingbot-config.service" /etc/systemd/system/drawingbot-config.service

BOOT=/boot/firmware; [ -d "$BOOT" ] || BOOT=/boot
if [ ! -f "$BOOT/drawingbot.txt" ]; then
  say "A criar $BOOT/drawingbot.txt…"
  # Start from the current state so installing does not change the network or the name.
  COUNTRY="$(raspi-config nonint get_wifi_country 2>/dev/null || true)"
  [[ "$COUNTRY" =~ ^[A-Z]{2}$ ]] || COUNTRY=PT
  sed -e "s/^hostname=.*/hostname=$(hostname)/" -e "s/^wifi_country=.*/wifi_country=$COUNTRY/" \
    "$APP_DIR/drawingbot.txt" | sed 's/$/\r/' > "$BOOT/drawingbot.txt"
fi

say "A ativar os serviços…"
systemctl daemon-reload
systemctl enable drawingbot-config.service drawingbot.service >/dev/null
/usr/local/sbin/drawingbot-apply-config || true
systemctl restart drawingbot.service

sleep 2
if systemctl is-active --quiet drawingbot.service; then
  say "DrawingBot instalado."
  echo "Abre http://$(hostname).local num browser da mesma rede."
  echo "Configuração (Wi-Fi, nome, PIN): $BOOT/drawingbot.txt — editável no cartão SD a partir de qualquer computador."
else
  fail "o serviço não arrancou. Vê os detalhes com: journalctl -u drawingbot -n 50"
fi
