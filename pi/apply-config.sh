#!/usr/bin/env bash
# Applies drawingbot.txt from the boot partition: Wi-Fi, country, hostname, PIN and USB port.
# Runs at every boot (drawingbot-config.service) and can be run by hand:
#   sudo drawingbot-apply-config
# Testing without changing anything: DRY_RUN=1 DRAWINGBOT_CONF=./drawingbot.txt bash apply-config.sh
set -u

CONF="${DRAWINGBOT_CONF:-}"
if [ -z "$CONF" ]; then
  for candidate in /boot/firmware/drawingbot.txt /boot/drawingbot.txt; do
    if [ -f "$candidate" ]; then CONF="$candidate"; break; fi
  done
fi
STATE_DIR="${DRAWINGBOT_STATE:-/var/lib/drawingbot}"
ENV_FILE="${DRAWINGBOT_ENV:-/etc/drawingbot/env}"
DRY="${DRY_RUN:-0}"

log() { echo "drawingbot-config: $*"; }
run() {
  if [ "$DRY" = 1 ]; then printf 'DRY:'; printf ' %q' "$@"; echo; return 0; fi
  "$@"
}

if [ -z "$CONF" ] || [ ! -f "$CONF" ]; then log "drawingbot.txt não encontrado; nada a aplicar."; exit 0; fi

# Value of a key. Tolerates Windows line endings, a UTF-8 BOM, spaces and "quotes".
get() {
  sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//' "$CONF" | awk -v want="$1" '
    /^[[:space:]]*#/ { next }
    index($0, "=") > 0 {
      key = substr($0, 1, index($0, "=") - 1); gsub(/^[ \t]+|[ \t]+$/, "", key)
      if (key != want) next
      value = substr($0, index($0, "=") + 1); gsub(/^[ \t]+|[ \t]+$/, "", value)
      if (value ~ /^".*"$/) value = substr(value, 2, length(value) - 2)
      found = value
    }
    END { printf "%s", found }'
}
saved() { cat "$STATE_DIR/$1" 2>/dev/null; }
remember() { if [ "$DRY" != 1 ]; then mkdir -p "$STATE_DIR"; printf '%s' "$2" > "$STATE_DIR/$1"; fi; }

# --- Wi-Fi country (regulatory domain); Raspberry Pi OS keeps Wi-Fi blocked until it is set ---
COUNTRY="$(get wifi_country | tr '[:lower:]' '[:upper:]')"
if [ -n "$COUNTRY" ]; then
  if [[ "$COUNTRY" =~ ^[A-Z]{2}$ ]]; then
    if [ "$COUNTRY" != "$(saved country)" ]; then
      if command -v raspi-config >/dev/null 2>&1; then run raspi-config nonint do_wifi_country "$COUNTRY"
      else run iw reg set "$COUNTRY"; fi
      remember country "$COUNTRY"; log "país Wi-Fi: $COUNTRY"
    fi
  else log "wifi_country inválido: $COUNTRY"; fi
fi
command -v rfkill >/dev/null 2>&1 && run rfkill unblock wifi

# --- Hostname (http://<hostname>.local) ---
NAME="$(get hostname | tr '[:upper:]' '[:lower:]')"
if [ -n "$NAME" ]; then
  if [[ "$NAME" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
    if [ "$NAME" != "$(hostname)" ]; then
      run hostnamectl set-hostname "$NAME"
      if grep -q '^127\.0\.1\.1' /etc/hosts; then run sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t$NAME/" /etc/hosts
      elif [ "$DRY" = 1 ]; then echo "DRY: acrescentar 127.0.1.1 $NAME a /etc/hosts"
      else printf '127.0.1.1\t%s\n' "$NAME" >> /etc/hosts; fi
      command -v systemctl >/dev/null && systemctl is-active --quiet avahi-daemon && run systemctl restart avahi-daemon
      log "nome na rede: $NAME.local"
    fi
  else log "hostname inválido: $NAME (usa letras, números e hífen)"; fi
fi

# --- Wi-Fi network (NetworkManager) ---
SSID="$(get wifi_ssid)"
PASS="$(get wifi_password)"
HIDDEN="$(get wifi_hidden | tr '[:upper:]' '[:lower:]')"
if [ -n "$SSID" ]; then
  if ! command -v nmcli >/dev/null 2>&1 && [ "$DRY" != 1 ]; then
    log "NetworkManager não encontrado; usa Raspberry Pi OS Bookworm ou mais recente."
  elif [ -n "$PASS" ] && { [ ${#PASS} -lt 8 ] || [ ${#PASS} -gt 63 ]; }; then
    log "wifi_password tem de ter entre 8 e 63 caracteres; Wi-Fi não alterado."
  else
    SUM="$(printf '%s\n%s\n%s' "$SSID" "$PASS" "$HIDDEN" | sha256sum | cut -d' ' -f1)"
    EXISTS=0
    if [ "$DRY" != 1 ] && nmcli -t -f NAME connection show 2>/dev/null | grep -qx 'drawingbot-wifi'; then EXISTS=1; fi
    if [ "$SUM" != "$(saved wifi.sum)" ] || [ "$EXISTS" = 0 ]; then
      [ "$EXISTS" = 1 ] && run nmcli connection delete drawingbot-wifi
      ARGS=(connection add type wifi ifname wlan0 con-name drawingbot-wifi ssid "$SSID"
        connection.autoconnect yes connection.autoconnect-priority 50)
      [ "$HIDDEN" = yes ] && ARGS+=(802-11-wireless.hidden yes)
      [ -n "$PASS" ] && ARGS+=(wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PASS")
      if [ "$DRY" = 1 ]; then echo "DRY: nmcli ${ARGS[*]:0:9} «$SSID» hidden=${HIDDEN:-no} (palavra-passe omitida)"
      elif nmcli "${ARGS[@]}" >/dev/null; then
        remember wifi.sum "$SUM"; log "rede Wi-Fi configurada: $SSID"
        (nmcli --wait 40 connection up drawingbot-wifi >/dev/null 2>&1 || log "a rede $SSID ainda não respondeu") &
      else log "não foi possível configurar a rede $SSID"; fi
    fi
  fi
fi

# --- DrawingBot service settings ---
PIN="$(get pin)"
SERIAL="$(get serial_port)"; SERIAL="${SERIAL:-auto}"
if ! [[ "$PIN" =~ ^[A-Za-z0-9]{0,32}$ ]]; then log "pin inválido (só letras e números, até 32); PIN ignorado."; PIN=""; fi
if ! [[ "$SERIAL" =~ ^(auto|/dev/[A-Za-z0-9/_.:-]+)$ ]]; then log "serial_port inválido; a usar auto."; SERIAL=auto; fi
CONTENT="DRAWINGBOT_PIN=$PIN
DRAWINGBOT_SERIAL=$SERIAL"
if [ "$DRY" = 1 ]; then echo "DRY: $ENV_FILE ← DRAWINGBOT_SERIAL=$SERIAL, PIN $([ -n "$PIN" ] && echo definido || echo vazio)"
elif [ "$CONTENT" != "$(cat "$ENV_FILE" 2>/dev/null)" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  TMP="$(mktemp)"; printf '%s\n' "$CONTENT" > "$TMP"
  install -m 640 -o root -g drawingbot "$TMP" "$ENV_FILE" 2>/dev/null || install -m 600 "$TMP" "$ENV_FILE"
  rm -f "$TMP"
  systemctl is-active --quiet drawingbot && systemctl restart drawingbot
  log "definições do DrawingBot atualizadas"
fi
exit 0
