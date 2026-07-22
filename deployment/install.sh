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
STEAM_MASTER_PORT="${MYDST_STEAM_MASTER_PORT:-12346}"
STEAM_CAVES_PORT="${MYDST_STEAM_CAVES_PORT:-12347}"

for value in "$PANEL_PORT" "$STEAM_MASTER_PORT" "$STEAM_CAVES_PORT"; do
  if ! [[ "$value" =~ ^[0-9]+$ ]] || (( value < 1024 || value > 65535 )); then
    echo "Invalid port: $value" >&2
    exit 1
  fi
done
if [[ "$STEAM_MASTER_PORT" == "$STEAM_CAVES_PORT" ]]; then
  echo "Game ports must be unique." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
log_step() { printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"; }

download_file() {
  local url="$1"
  local destination="$2"
  local attempt
  for attempt in 1 2 3 4 5; do
    if [[ -s "$destination" ]] && { [[ "$destination" != *.tar.gz.part ]] || gzip -t "$destination" >/dev/null 2>&1; }; then
      return 0
    fi
    echo "Downloading $(basename "$destination") (attempt $attempt/5)..."
    if curl -4 --http1.1 -fL --retry 3 --retry-all-errors --retry-delay 4 \
      --connect-timeout 20 --max-time 600 --continue-at - \
      -o "$destination" "$url"; then
      return 0
    fi
    sleep 5
  done
  echo "Download failed after retries: $url" >&2
  return 1
}

download_script() {
  local url="$1"
  local destination
  destination="$(mktemp)"
  if ! curl -4 --http1.1 -fL --retry 5 --retry-all-errors --retry-delay 4 \
    --connect-timeout 20 --max-time 300 -o "$destination" "$url"; then
    rm -f "$destination"
    return 1
  fi
  local status=0
  bash "$destination" || status=$?
  rm -f "$destination"
  return "$status"
}

APT_NETWORK_CONFIG="/etc/apt/apt.conf.d/99mydst-install-network"
APT_SOURCE_FILES=("/etc/apt/sources.list" "/etc/apt/sources.list.d/ubuntu.sources")
APT_NETWORK_PREPARED=false

restore_apt_configuration() {
  rm -f "$APT_NETWORK_CONFIG"
  local source backup
  for source in "${APT_SOURCE_FILES[@]}"; do
    backup="${source}.mydst-original"
    if [[ -f "$backup" ]]; then
      mv -f "$backup" "$source"
    fi
  done
}

select_ubuntu_mirror() {
  if [[ -n "${MYDST_APT_MIRROR:-}" ]]; then
    APT_MIRROR="${MYDST_APT_MIRROR%/}"
    return
  fi
  local candidate probe
  for candidate in \
    "https://mirrors.aliyun.com/ubuntu" \
    "https://mirrors.cloud.tencent.com/ubuntu" \
    "https://mirrors.tuna.tsinghua.edu.cn/ubuntu" \
    "http://archive.ubuntu.com/ubuntu"; do
    probe="$candidate/dists/${VERSION_CODENAME}/InRelease"
    if ! command -v curl >/dev/null 2>&1 || curl -4 --http1.1 -fsL --range 0-1023 --connect-timeout 4 --max-time 8 -o /dev/null "$probe"; then
      APT_MIRROR="$candidate"
      return
    fi
  done
  APT_MIRROR="http://archive.ubuntu.com/ubuntu"
}

prepare_apt_network() {
  [[ "$APT_NETWORK_PREPARED" == true ]] && return
  restore_apt_configuration
  select_ubuntu_mirror
  local source backup
  for source in "${APT_SOURCE_FILES[@]}"; do
    [[ -f "$source" ]] || continue
    backup="${source}.mydst-original"
    cp -a "$source" "$backup"
    sed -i -E "s#https?://(([a-zA-Z0-9.-]+\\.)?archive\\.ubuntu\\.com|security\\.ubuntu\\.com)/ubuntu#${APT_MIRROR}#g" "$source"
    sed -i -E "s/[[:space:]]+${VERSION_CODENAME}-backports//g" "$source"
  done
  cat > "$APT_NETWORK_CONFIG" <<'EOF'
Acquire::ForceIPv4 "true";
Acquire::Retries "2";
Acquire::http::Timeout "12";
Acquire::https::Timeout "12";
Acquire::Languages "none";
EOF
  APT_NETWORK_PREPARED=true
  trap restore_apt_configuration EXIT
  echo "Ubuntu package mirror: $APT_MIRROR"
}

package_installed() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q '^install ok installed$'
}

log_step "Preparing Ubuntu packages"
dpkg --add-architecture i386
SYSTEM_PACKAGES=(ca-certificates curl xz-utils tar tmux openssl rsync lib32gcc-s1 libstdc++6:i386)
CURL32_PACKAGE=""
for candidate in libcurl3t64-gnutls:i386 libcurl3-gnutls:i386 libcurl4-gnutls-dev:i386; do
  if package_installed "$candidate"; then
    CURL32_PACKAGE="$candidate"
    break
  fi
done
PACKAGES_READY=true
for package in "${SYSTEM_PACKAGES[@]}"; do
  package_installed "$package" || PACKAGES_READY=false
done
[[ -n "$CURL32_PACKAGE" ]] || PACKAGES_READY=false

if [[ "$PACKAGES_READY" == true ]]; then
  echo "Ubuntu and SteamCMD dependencies are already installed; skipping apt update."
else
  prepare_apt_network
  apt-get update
  if [[ -z "$CURL32_PACKAGE" ]]; then
    for candidate in libcurl3t64-gnutls:i386 libcurl3-gnutls:i386 libcurl4-gnutls-dev:i386; do
      if apt-cache show "$candidate" >/dev/null 2>&1; then
        CURL32_PACKAGE="$candidate"
        break
      fi
    done
  fi
  if [[ -z "$CURL32_PACKAGE" ]]; then
    echo "Unable to locate a supported 32-bit libcurl package." >&2
    exit 1
  fi
  log_step "Installing Ubuntu packages"
  apt-get install -y --no-install-recommends "${SYSTEM_PACKAGES[@]}" "$CURL32_PACKAGE"
fi

SETUP_TOKEN="$(openssl rand -hex 12)"

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -lt 22 ]]; then
  log_step "Installing Node.js 22"
  prepare_apt_network
  download_script "https://deb.nodesource.com/setup_22.x"
  apt-get install -y nodejs
fi

if ! id dst >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$ROOT" --shell /bin/bash dst
fi

install -d -o dst -g dst -m 0750 "$ROOT" "$ROOT/game" "$ROOT/data" "$ROOT/backups" "$ROOT/steamcmd" "$ROOT/tmux"
install -d -o root -g dst -m 0750 "$PANEL_DIR"
log_step "Copying panel source"
rsync -a --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .runtime \
  --exclude '.runtime-*' \
  --exclude .git \
  "$SOURCE_DIR/" "$PANEL_DIR/"

cd "$PANEL_DIR"
log_step "Installing panel dependencies"
npm_config_fetch_retries=5 npm_config_fetch_retry_mintimeout=5000 npm_config_fetch_retry_maxtimeout=60000 npm ci
log_step "Building panel"
npm run build
npm prune --omit=dev
chmod 0755 deployment/run-shard.sh
chown -R root:dst "$PANEL_DIR"
chmod -R g+rX,o-rwx "$PANEL_DIR"

if [[ ! -x "$ROOT/steamcmd/steamcmd.sh" ]]; then
  log_step "Downloading SteamCMD"
  STEAMCMD_ARCHIVE="$ROOT/.steamcmd_linux.tar.gz.part"
  download_file "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" "$STEAMCMD_ARCHIVE"
  gzip -t "$STEAMCMD_ARCHIVE"
  tar -tzf "$STEAMCMD_ARCHIVE" >/dev/null
  tar -xzf "$STEAMCMD_ARCHIVE" -C "$ROOT/steamcmd"
  rm -f "$STEAMCMD_ARCHIVE"
  chown -R dst:dst "$ROOT/steamcmd"
fi

log_step "Installing or updating Don't Starve Together Dedicated Server"
for attempt in 1 2 3; do
  if runuser -u dst -- "$ROOT/steamcmd/steamcmd.sh" \
    +force_install_dir "$ROOT/game" \
    +login anonymous \
    +app_update 343050 validate \
    +quit; then
    break
  fi
  if [[ "$attempt" == 3 ]]; then
    echo "DST download/update failed after retries." >&2
    exit 1
  fi
  echo "DST update failed; SteamCMD will retry and resume partial files (attempt $((attempt + 1))/3)..." >&2
  sleep 10
done

chown -R dst:dst "$ROOT/game" "$ROOT/data" "$ROOT/backups" "$ROOT/steamcmd"

cat > /etc/mydst-panel.env <<EOF
NODE_ENV=production
PORT=$PANEL_PORT
MYDST_ROOT=$ROOT
MYDST_DEMO=false
MYDST_SETUP_TOKEN=$SETUP_TOKEN
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
  ufw allow "$STEAM_MASTER_PORT/udp" comment "MyDST Steam Master"
  ufw allow "$STEAM_CAVES_PORT/udp" comment "MyDST Steam Caves"
fi

echo
echo "MyDST installation completed."
echo "Panel local URL: http://$(hostname -I | awk '{print $1}'):$PANEL_PORT"
echo "Panel public URL: use the public IP/domain and mapped external TCP port from your server provider."
echo "One-time setup token: $SETUP_TOKEN"
echo "Service status: systemctl status mydst-panel"
