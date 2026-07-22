#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run this installer as root." >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "This installer requires Ubuntu 22.04 or 24.04." >&2
  exit 1
fi
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "22.04" && "${VERSION_ID:-}" != "24.04" ]]; then
  echo "Supported operating systems: Ubuntu 22.04 and Ubuntu 24.04 (found ${PRETTY_NAME:-unknown})." >&2
  exit 1
fi

ROOT="/opt/mydst"
PANEL_DIR="$ROOT/panel"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PANEL_PORT="${MYDST_PANEL_PORT:-8114}"
MASTER_PORT="${MYDST_MASTER_PORT:-8489}"
CAVES_PORT="${MYDST_CAVES_PORT:-8114}"
STEAM_MASTER_PORT="${MYDST_STEAM_MASTER_PORT:-12346}"
STEAM_CAVES_PORT="${MYDST_STEAM_CAVES_PORT:-12347}"

for value in "$PANEL_PORT" "$MASTER_PORT" "$CAVES_PORT" "$STEAM_MASTER_PORT" "$STEAM_CAVES_PORT"; do
  if ! [[ "$value" =~ ^[0-9]+$ ]] || (( value < 1024 || value > 65535 )); then
    echo "Invalid port: $value" >&2
    exit 1
  fi
done
if [[ "$MASTER_PORT" == "$CAVES_PORT" || "$MASTER_PORT" == "$STEAM_MASTER_PORT" || "$MASTER_PORT" == "$STEAM_CAVES_PORT" || "$CAVES_PORT" == "$STEAM_MASTER_PORT" || "$CAVES_PORT" == "$STEAM_CAVES_PORT" || "$STEAM_MASTER_PORT" == "$STEAM_CAVES_PORT" ]]; then
  echo "Game ports must be unique." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
dpkg --add-architecture i386
apt-get update
CURL32_PACKAGE=""
for candidate in libcurl3t64-gnutls:i386 libcurl3-gnutls:i386 libcurl4-gnutls-dev:i386; do
  if apt-cache show "$candidate" >/dev/null 2>&1; then
    CURL32_PACKAGE="$candidate"
    break
  fi
done
if [[ -z "$CURL32_PACKAGE" ]]; then
  echo "Unable to locate a supported 32-bit libcurl package." >&2
  exit 1
fi
apt-get install -y --no-install-recommends \
  ca-certificates curl xz-utils tar tmux openssl rsync \
  lib32gcc-s1 libstdc++6:i386 "$CURL32_PACKAGE"

SETUP_TOKEN="$(openssl rand -hex 12)"

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! id dst >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$ROOT" --shell /bin/bash dst
fi

install -d -o dst -g dst -m 0750 "$ROOT" "$ROOT/game" "$ROOT/data" "$ROOT/backups" "$ROOT/steamcmd" "$ROOT/tmux"
install -d -o root -g dst -m 0750 "$PANEL_DIR"
rsync -a --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .runtime \
  --exclude .git \
  "$SOURCE_DIR/" "$PANEL_DIR/"

cd "$PANEL_DIR"
npm ci
npm run build
npm prune --omit=dev
chmod 0755 deployment/run-shard.sh
chown -R root:dst "$PANEL_DIR"
chmod -R g+rX,o-rwx "$PANEL_DIR"

if [[ ! -x "$ROOT/steamcmd/steamcmd.sh" ]]; then
  curl -fsSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz \
    | tar -xz -C "$ROOT/steamcmd"
  chown -R dst:dst "$ROOT/steamcmd"
fi

echo "Installing or updating Don't Starve Together Dedicated Server..."
runuser -u dst -- "$ROOT/steamcmd/steamcmd.sh" \
  +force_install_dir "$ROOT/game" \
  +login anonymous \
  +app_update 343050 validate \
  +quit

chown -R dst:dst "$ROOT/game" "$ROOT/data" "$ROOT/backups" "$ROOT/steamcmd"

cat > /etc/mydst-panel.env <<EOF
NODE_ENV=production
PORT=$PANEL_PORT
MYDST_ROOT=$ROOT
MYDST_DEMO=false
MYDST_SETUP_TOKEN=$SETUP_TOKEN
MYDST_MASTER_PORT=$MASTER_PORT
MYDST_CAVES_PORT=$CAVES_PORT
MYDST_STEAM_MASTER_PORT=$STEAM_MASTER_PORT
MYDST_STEAM_CAVES_PORT=$STEAM_CAVES_PORT
TMUX_TMPDIR=$ROOT/tmux
COOKIE_SECURE=false
TRUST_PROXY=false
TZ=Asia/Shanghai
EOF
chown root:dst /etc/mydst-panel.env
chmod 0640 /etc/mydst-panel.env

install -o root -g root -m 0644 deployment/mydst-panel.service /etc/systemd/system/mydst-panel.service
systemctl daemon-reload
systemctl enable --now mydst-panel.service

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow "$PANEL_PORT/tcp" comment "MyDST panel"
  ufw allow "$MASTER_PORT/udp" comment "MyDST Master"
  ufw allow "$CAVES_PORT/udp" comment "MyDST Caves"
  ufw allow "$STEAM_MASTER_PORT/udp" comment "MyDST Steam Master"
  ufw allow "$STEAM_CAVES_PORT/udp" comment "MyDST Steam Caves"
fi

echo
echo "MyDST installation completed."
echo "Panel URL: http://$(hostname -I | awk '{print $1}'):$PANEL_PORT"
echo "Master UDP port: $MASTER_PORT"
echo "Caves UDP port: $CAVES_PORT"
echo "One-time setup token: $SETUP_TOKEN"
echo "Service status: systemctl status mydst-panel"
