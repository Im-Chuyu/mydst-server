#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${MYDST_ROOT:-/opt/mydst}"
SHARD="${1:-}"

case "$SHARD" in
  Master|Caves) ;;
  *)
    echo "Invalid shard: $SHARD" >&2
    exit 2
    ;;
esac

if [[ -x "$ROOT/game/bin64/dontstarve_dedicated_server_nullrenderer_x64" ]]; then
  GAME_BINARY="$ROOT/game/bin64/dontstarve_dedicated_server_nullrenderer_x64"
elif [[ -x "$ROOT/game/bin/dontstarve_dedicated_server_nullrenderer" ]]; then
  GAME_BINARY="$ROOT/game/bin/dontstarve_dedicated_server_nullrenderer"
else
  echo "DST dedicated server binary was not found (bin64 or bin)." >&2
  exit 1
fi

cd "$(dirname "$GAME_BINARY")"
exec "./$(basename "$GAME_BINARY")" \
  -console \
  -persistent_storage_root "$ROOT/data" \
  -ugc_directory "$ROOT/data/ugc" \
  -cluster Cluster_1 \
  -shard "$SHARD"
