#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run this updater as root." >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PANEL_DIR="/opt/mydst/panel"

install -d -o dst -g dst -m 0750 /opt/mydst/tmux
sed -i '/^PUBLIC_HOST=/d' /etc/mydst-panel.env
if grep -q '^TMUX_TMPDIR=' /etc/mydst-panel.env; then
  sed -i 's#^TMUX_TMPDIR=.*#TMUX_TMPDIR=/opt/mydst/tmux#' /etc/mydst-panel.env
else
  echo 'TMUX_TMPDIR=/opt/mydst/tmux' >> /etc/mydst-panel.env
fi

systemctl stop mydst-panel
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
systemctl start mydst-panel
systemctl --no-pager --full status mydst-panel
