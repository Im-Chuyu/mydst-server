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

cd "$ROOT/game/bin"
exec ./dontstarve_dedicated_server_nullrenderer \
  -console \
  -persistent_storage_root "$ROOT/data" \
  -ugc_directory "$ROOT/data/ugc" \
  -cluster Cluster_1 \
  -shard "$SHARD"
