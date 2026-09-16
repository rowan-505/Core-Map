#!/usr/bin/env bash
# Rebuild Myanmar overview PMTiles from local Core admin + Natural Earth.
#
# Does NOT run tiles:sync (keep sync separate for reproducibility).
# Does NOT upload, query Supabase, or touch regional PMTiles.
#
# Flow:
#   1. export Core admin overview GeoJSONSeq
#   2. prepare/clip Natural Earth overview inputs (as needed)
#   3. validate overview source + build inputs
#   4. build overview PMTiles (temp → atomic replace)
#   5. verify generated archive
#
# Usage:
#   npm run tiles:rebuild:overview
#   bash infrastructure/tiles/pmtiles/scripts/rebuild-overview.sh [version]
#
# Env:
#   FORCE_NE_CLIP=1  — always re-clip Natural Earth
#   SKIP_NE_CLIP=1   — never clip (fail if clipped NE missing)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
VERSION="${1:-v2}"

NE_CLIPPED="${REPO_ROOT}/infrastructure/tiles/data/processed/natural-earth/clipped/land.geojsonseq"
OVERVIEW_PMTILES="${REPO_ROOT}/infrastructure/tiles/pmtiles/overview/regions/myanmar-overview-${VERSION}.pmtiles"

log() { echo "[rebuild-overview] $*" >&2; }
fail() { echo "[rebuild-overview] FAILURE: $*" >&2; exit 1; }

log "start version=${VERSION}"
log "does not run tiles:sync — sync local admin first if Core boundaries changed"

# ---------------------------------------------------------------------------
# 1. Overview export (Core admin from LOCAL_TILE_DATABASE_URL)
# ---------------------------------------------------------------------------
log "stage 1/5: overview export"
bash "${SCRIPT_DIR}/export-overview-admin.sh" \
  || fail "overview export failed — previous overview archive left unchanged"

# ---------------------------------------------------------------------------
# 2. Natural Earth preparation (as needed)
# ---------------------------------------------------------------------------
log "stage 2/5: Natural Earth preparation"
if [[ "${SKIP_NE_CLIP:-0}" == "1" ]]; then
  [[ -f "$NE_CLIPPED" ]] || fail "SKIP_NE_CLIP=1 but missing ${NE_CLIPPED}"
  log "skipping Natural Earth clip (SKIP_NE_CLIP=1)"
elif [[ "${FORCE_NE_CLIP:-0}" == "1" || ! -f "$NE_CLIPPED" ]]; then
  if [[ "${FORCE_NE_CLIP:-0}" == "1" ]]; then
    log "FORCE_NE_CLIP=1 — re-clipping Natural Earth"
  else
    log "clipped Natural Earth missing — running clip"
  fi
  bash "${REPO_ROOT}/infrastructure/tiles/scripts/clip-natural-earth-overview.sh" \
    || fail "Natural Earth clip failed — previous overview archive left unchanged"
else
  log "clipped Natural Earth present — skip clip (set FORCE_NE_CLIP=1 to refresh)"
fi

# ---------------------------------------------------------------------------
# 3. Validate overview source inputs
# ---------------------------------------------------------------------------
log "stage 3/5: overview validation"
bash "${SCRIPT_DIR}/validate-overview-source.sh" \
  || fail "overview source validation failed — previous overview archive left unchanged"
VALIDATE_ONLY=1 bash "${SCRIPT_DIR}/build-overview.sh" "$VERSION" \
  || fail "overview build-input validation failed — previous overview archive left unchanged"

# ---------------------------------------------------------------------------
# 4. Tippecanoe build + PMTiles conversion (atomic replace inside build script)
# ---------------------------------------------------------------------------
log "stage 4/5: tippecanoe build + PMTiles conversion"
PREV_SIZE=""
if [[ -f "$OVERVIEW_PMTILES" ]]; then
  PREV_SIZE="$(wc -c <"$OVERVIEW_PMTILES" | tr -d ' ')"
  log "preserving previous good overview until new build succeeds (${PREV_SIZE} bytes)"
fi
bash "${SCRIPT_DIR}/build-overview.sh" "$VERSION" \
  || fail "overview build failed — previous overview archive left unchanged"

# ---------------------------------------------------------------------------
# 5. Verify generated archive
# ---------------------------------------------------------------------------
log "stage 5/5: verification"
bash "${SCRIPT_DIR}/verify-overview-local.sh" "$VERSION" \
  || fail "overview verification failed after replace — inspect ${OVERVIEW_PMTILES}"

NEW_SIZE="$(wc -c <"$OVERVIEW_PMTILES" | tr -d ' ')"
log "SUCCESS overview=${OVERVIEW_PMTILES} size=${NEW_SIZE} bytes"
if [[ -n "$PREV_SIZE" ]]; then
  log "previous size was ${PREV_SIZE} bytes"
fi
log "next: local QA → npm run tiles:upload:overview -- ${VERSION}"
log "then: npm run tiles:verify:r2:overview -- ${VERSION}"
log "then: CONFIRM=1 npm run tiles:switch:overview -- ${VERSION}"
