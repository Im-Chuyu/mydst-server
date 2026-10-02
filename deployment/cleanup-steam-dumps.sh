#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${MYDST_ROOT:-/opt/mydst}"

find /tmp -mindepth 1 -maxdepth 1 -name 'dumps*' -exec rm -rf -- {} +
install -d -o dst -g dst -m 0700 "$ROOT/tmp"
if [[ -d "$ROOT/Steam" ]]; then
  chown -R dst:dst "$ROOT/Steam"
fi
