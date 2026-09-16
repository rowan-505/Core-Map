#!/usr/bin/env bash
# Local static server for the PMTiles tree (same URL layout as CDN / R2).
#
# Uses Python so it works in WSL even when Windows npm/npx is on PATH.
# Windows npm may start bash in C:\Windows; INIT_CWD still points at the repo.
set -euo pipefail

to_linux_path() {
  local raw="${1:-}"
  raw="${raw//\\//}"
  if [[ "$raw" =~ [Ww]sl\.localhost/[^/]+/(.*) ]]; then
    echo "/${BASH_REMATCH[1]}"
    return
  fi
  echo "$raw"
}

SCRIPT_PATH="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=""
if [[ -n "$SCRIPT_PATH" && -f "$SCRIPT_PATH" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
fi

if [[ -z "$SCRIPT_DIR" || ! -f "$SCRIPT_DIR/serve-local.py" ]]; then
  ROOT="$(to_linux_path "${INIT_CWD:-}")"
  if [[ -z "$ROOT" || ! -d "$ROOT" ]]; then
    echo "error: cannot find repo (INIT_CWD=${INIT_CWD:-unset} cwd=$(pwd))" >&2
    echo "Run from the repo: bash infrastructure/tiles/pmtiles/scripts/serve-local.sh" >&2
    exit 1
  fi
  SCRIPT_DIR="$ROOT/infrastructure/tiles/pmtiles/scripts"
fi

if [[ ! -f "$SCRIPT_DIR/serve-local.py" ]]; then
  echo "error: missing $SCRIPT_DIR/serve-local.py" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 not found. Install Python 3 in WSL, then retry." >&2
  exit 1
fi

exec python3 "$SCRIPT_DIR/serve-local.py"
