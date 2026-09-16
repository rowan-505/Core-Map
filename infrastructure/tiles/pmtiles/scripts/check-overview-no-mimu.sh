#!/usr/bin/env bash
# Fail if ACTIVE overview pipeline code reintroduces MIMU schema paths/properties.
#
# Scans only active overview code (scripts, map-style overview, web overview helpers).
# Does NOT scan docs/archive, migration notes, or historical Git history.
#
# Forbidden strings:
#   processed/mimu
#   PCode_V
#   ST_MMR
#   ST_PCODE
#   ST_RG
#
# Usage:
#   npm run tiles:check:overview-no-mimu
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"

PATTERNS='processed/mimu|PCode_V|ST_MMR|ST_PCODE|ST_RG'

# Active overview code surfaces only (not archive docs, not regional PMTiles).
# Markdown docs are excluded so human "do not use …" notes do not false-fail.
PATHS=(
  "${REPO_ROOT}/infrastructure/tiles/pmtiles/scripts"
  "${REPO_ROOT}/infrastructure/tiles/scripts"
  "${REPO_ROOT}/packages/map-style"
  "${REPO_ROOT}/apps/web/src/features/map/lib/maplibre"
  "${REPO_ROOT}/apps/web/src/features/map/config"
)

echo "[tiles:check:overview-no-mimu] scanning active overview code..." >&2

HITS="$(
  rg -n --no-heading \
    -g '*.{sh,py,ts,tsx,js,cjs,mjs,json}' \
    -g '!**/docs/archive/**' \
    -g '!**/*.test.ts' \
    -g '!**/*.test.tsx' \
    -g '!**/*.test.js' \
    -g '!**/check-overview-no-mimu.sh' \
    -g '!**/assert-overview-export-reads-live-db.sh' \
    -e "$PATTERNS" \
    "${PATHS[@]}" \
    2>/dev/null || true
)"

FILTERED="$(
  printf '%s\n' "$HITS" | grep -v '^$' || true
)"

if [[ -n "$FILTERED" ]]; then
  echo "[tiles:check:overview-no-mimu] FAILURE — forbidden MIMU schema markers found:" >&2
  printf '%s\n' "$FILTERED" >&2
  exit 1
fi

# Directory must not exist as an active processed input.
if [[ -d "${REPO_ROOT}/infrastructure/tiles/data/processed/mimu" ]]; then
  echo "[tiles:check:overview-no-mimu] FAILURE — directory exists: infrastructure/tiles/data/processed/mimu" >&2
  echo "  remove it; Myanmar admin comes from Core tile_source.admin_areas" >&2
  exit 1
fi

echo "[tiles:check:overview-no-mimu] PASS — no processed/mimu or PCode/ST_* markers in active overview code" >&2
