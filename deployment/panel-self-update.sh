#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="/etc/mydst-panel.env"
if [[ -r "$ENV_FILE" ]]; then
  # shellcheck disable=SC1091
  . "$ENV_FILE"
fi

SOURCE_DIR="${MYDST_SOURCE_DIR:-/opt/mydst-server}"
PANEL_DIR="${MYDST_ROOT:-/opt/mydst}/panel"
ROOT="${MYDST_ROOT:-/opt/mydst}"
REQUEST_FILE="$ROOT/panel-update.request"
STATE_FILE="$ROOT/panel-update.state"
LOCK_FILE="/run/lock/mydst-panel-update.lock"

write_state() {
  local status="$1" message="$2" temporary
  temporary="${STATE_FILE}.$$"
  printf '{"status":"%s","message":"%s","updatedAt":"%s"}\n' "$status" "$message" "$(date --iso-8601=seconds)" > "$temporary"
  install -o root -g dst -m 0640 "$temporary" "$STATE_FILE"
  rm -f "$temporary"
}

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

rm -f "$REQUEST_FILE"
write_state running "正在从 GitHub 拉取后台源码"

if [[ ! -d "$SOURCE_DIR/.git" ]]; then
  write_state failed "源码目录不是 Git 仓库"
  exit 1
fi
if ! git -c "safe.directory=$SOURCE_DIR" -C "$SOURCE_DIR" -c http.version=HTTP/1.1 pull --ff-only; then
  write_state failed "GitHub 源码拉取失败"
  exit 1
fi

write_state running "正在构建并重启管理后台"
if ! bash "$SOURCE_DIR/deployment/update.sh"; then
  systemctl start mydst-panel || true
  write_state failed "管理后台构建或重启失败"
  exit 1
fi

write_state success "管理后台更新完成"
