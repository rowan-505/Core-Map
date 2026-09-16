#!/usr/bin/env bash
# Architecture assertion: overview admin export must read live local DB geometry.
#
# Proves export-overview-admin.sh:
#   - queries tile_source.admin_areas via LOCAL_TILE_DATABASE_URL / ogr2ogr PG:
#   - does not copy from a committed myanmar_country GeoJSON under the repo
#   - does not prefer MIMU / processed/mimu inputs
#
# Usage:
#   npm run tiles:check:overview-export-live-db
#   bash infrastructure/tiles/pmtiles/scripts/assert-overview-export-reads-live-db.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
EXPORT_SH="${SCRIPT_DIR}/export-overview-admin.sh"
BUILD_SH="${SCRIPT_DIR}/build-overview.sh"
REBUILD_SH="${SCRIPT_DIR}/rebuild-overview.sh"

fail() { echo "[assert-overview-export-live-db] FAIL: $*" >&2; exit 1; }
pass() { echo "[assert-overview-export-live-db] PASS: $*" >&2; }

[[ -f "$EXPORT_SH" ]] || fail "missing ${EXPORT_SH}"
[[ -f "$BUILD_SH" ]] || fail "missing ${BUILD_SH}"
[[ -f "$REBUILD_SH" ]] || fail "missing ${REBUILD_SH}"

EXPORT_TEXT="$(cat "$EXPORT_SH")"
BUILD_TEXT="$(cat "$BUILD_SH")"
REBUILD_TEXT="$(cat "$REBUILD_SH")"

echo "$EXPORT_TEXT" | grep -q 'tile_source.admin_areas' \
  || fail "export must SELECT from tile_source.admin_areas"
echo "$EXPORT_TEXT" | grep -q 'LOCAL_TILE_DATABASE_URL' \
  || fail "export must use LOCAL_TILE_DATABASE_URL"
echo "$EXPORT_TEXT" | grep -q 'PG:${LOCAL_TILE_DATABASE_URL}' \
  || fail "export must read via ogr2ogr PG:LOCAL_TILE_DATABASE_URL each run"
echo "$EXPORT_TEXT" | grep -q 'myanmar_country.geojsonseq' \
  || fail "export must write myanmar_country.geojsonseq intermediate"

if echo "$EXPORT_TEXT" | grep -E 'cp .*myanmar_country|cat .*committed.*myanmar|processed/mimu'; then
  fail "export must not copy committed/MIMU myanmar country geometry"
fi

COMMITTED_HITS="$(
  find "$REPO_ROOT" \
    \( -path '*/node_modules/*' -o -path '*/.git/*' -o -path '*/infrastructure/tiles/data/*' \) -prune \
    -o \( -name 'myanmar_country.geojson' -o -name 'myanmar_country.geojsonseq' -o -name 'myanmar_country.geojsonl' \) \
    -print 2>/dev/null || true
)"
if [[ -n "$COMMITTED_HITS" ]]; then
  fail "committed myanmar_country geometry found (must stay gitignored under data/processed only):"$'\n'"${COMMITTED_HITS}"
fi

echo "$BUILD_TEXT" | grep -q 'myanmar_country.geojsonseq' \
  || fail "build must consume myanmar_country.geojsonseq from overview export"

if echo "$BUILD_TEXT" | grep -qE 'processed/mimu|mmr_admin0|mmr_admin1|-L mmr_'; then
  fail "build must not tippecanoe MIMU / processed/mimu layers"
fi

echo "$REBUILD_TEXT" | grep -q 'export-overview-admin.sh' \
  || fail "rebuild must invoke export-overview-admin.sh"

# Must not execute tiles:sync — comments that say "Does NOT run tiles:sync" are OK.
if echo "$REBUILD_TEXT" | grep -E '^[^#]*\b(npm run tiles:sync|bash .*sync-supabase\.sh)'; then
  fail "rebuild must NOT auto-run tiles:sync"
fi

pass "exporter reads live tile_source.admin_areas; no committed myanmar_country override; no MIMU"
