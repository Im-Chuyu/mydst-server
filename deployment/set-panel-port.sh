#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run this command as root." >&2
  exit 1
fi

if [[ "$#" -ne 1 ]]; then
  echo "Usage: sudo bash set-panel-port.sh PORT" >&2
  echo "PORT must be an internal TCP port between 1024 and 65535." >&2
  exit 1
fi
if ! [[ "$1" =~ ^[0-9]{1,5}$ ]]; then
  echo "PORT must contain digits only." >&2
  exit 1
fi

PANEL_PORT="$((10#$1))"
if (( PANEL_PORT < 1024 || PANEL_PORT > 65535 )); then
  echo "PORT must be between 1024 and 65535." >&2
  exit 1
fi
ENV_FILE="/etc/mydst-panel.env"
SERVICE="mydst-panel"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "$ENV_FILE does not exist. Complete the first installation before configuring the panel port." >&2
  exit 1
fi
if ! systemctl cat "$SERVICE" >/dev/null 2>&1; then
  echo "The $SERVICE systemd service is not installed. Complete the first installation first." >&2
  exit 1
fi

CURRENT_PORT="$(awk -F= '/^PORT=/{print $2; exit}' "$ENV_FILE")"
if [[ "$CURRENT_PORT" != "$PANEL_PORT" ]] && command -v ss >/dev/null 2>&1 && ss -H -ltn "sport = :$PANEL_PORT" | grep -q .; then
  echo "TCP port $PANEL_PORT is already in use. Choose another mapped internal TCP port." >&2
  ss -H -ltnp "sport = :$PANEL_PORT" >&2 || true
  exit 1
fi

TEMP_FILE="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
ORIGINAL_FILE="$(mktemp "${ENV_FILE}.original.XXXXXX")"
cp -a "$ENV_FILE" "$ORIGINAL_FILE"
cleanup() { rm -f "$TEMP_FILE" "$ORIGINAL_FILE"; }
trap cleanup EXIT
awk -v port="$PANEL_PORT" '
  BEGIN { updated = 0 }
  /^PORT=/ { print "PORT=" port; updated = 1; next }
  { print }
  END { if (!updated) print "PORT=" port }
' "$ENV_FILE" > "$TEMP_FILE"
install -o root -g dst -m 0640 "$TEMP_FILE" "$ENV_FILE"

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow "$PANEL_PORT/tcp" comment "MyDST panel"
fi

systemctl restart "$SERVICE"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --connect-timeout 2 "http://127.0.0.1:$PANEL_PORT/api/health" >/dev/null 2>&1; then
    echo "Panel internal TCP port updated: ${CURRENT_PORT:-unset} -> $PANEL_PORT"
    echo "Configure the provider's public TCP endpoint to forward to internal TCP port $PANEL_PORT."
    echo "Panel service status: active"
    exit 0
  fi
  sleep 1
done

echo "The new port failed its health check. Restoring the previous panel configuration." >&2
install -o root -g dst -m 0640 "$ORIGINAL_FILE" "$ENV_FILE"
systemctl restart "$SERVICE" || true
journalctl -u "$SERVICE" -n 30 --no-pager >&2 || true
exit 1
