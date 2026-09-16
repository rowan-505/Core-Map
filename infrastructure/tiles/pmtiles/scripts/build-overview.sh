#!/usr/bin/env bash
# Build Myanmar overview PMTiles (v2 target) from Natural Earth + Core admin export.
#
# Prerequisites:
#   - Natural Earth clipped GeoJSONSeq
#   - npm run tiles:export:overview-admin  → myanmar_country / myanmar_state_region / myanmar_state_labels
#
# Myanmar national shape comes ONLY from myanmar_country (synced Core country geom).
# No MIMU. No coastline reconciliation. No NE+Core national merge.
#
# Native tippecanoe zoom: z0–z8. MapLibre overzooms z8 tiles for camera z9–z20.
#
# Usage:
#   bash infrastructure/tiles/pmtiles/scripts/build-overview.sh v2
#   VALIDATE_ONLY=1 bash infrastructure/tiles/pmtiles/scripts/build-overview.sh v2
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
DATA="${REPO_ROOT}/infrastructure/tiles/data/processed"
OVERVIEW_ROOT="${REPO_ROOT}/infrastructure/tiles/pmtiles/overview"
OVERVIEW_DIR="${OVERVIEW_ROOT}/regions"
CURRENT_JSON="${OVERVIEW_ROOT}/current.json"

VERSION="${1:-v2}"
FILENAME="myanmar-overview-${VERSION}.pmtiles"
OUTPUT="${OVERVIEW_DIR}/${FILENAME}"
OUTPUT_NEW="${OUTPUT}.new.$$"
CURRENT_NEW="${CURRENT_JSON}.new.$$"

NE="${DATA}/natural-earth/clipped"
CORE_ADMIN="${DATA}/overview"
MYANMAR_COUNTRY="${CORE_ADMIN}/myanmar_country.geojsonseq"
MYANMAR_STATE="${CORE_ADMIN}/myanmar_state_region.geojsonseq"
MYANMAR_LABELS="${CORE_ADMIN}/myanmar_state_labels.geojsonseq"

TMP_DIR=""
BUILD_OK=0

cleanup() {
  if [[ -n "${TMP_DIR:-}" && -d "${TMP_DIR}" ]]; then
    rm -rf "$TMP_DIR"
  fi
  rm -f "$OUTPUT_NEW" "$CURRENT_NEW"
  if [[ "$BUILD_OK" -ne 1 ]]; then
    if [[ -f "$OUTPUT" ]]; then
      echo "[build-overview] failure — previous good overview kept: ${OUTPUT}" >&2
    else
      echo "[build-overview] failure — no previous overview present" >&2
    fi
  fi
}
trap cleanup EXIT

require_geojsonseq_count() {
  local path="$1"
  local expected="$2"
  local label="$3"
  local actual
  actual="$(grep -c . "$path" || true)"
  if [[ "$actual" -ne "$expected" ]]; then
    echo "error: ${label} has ${actual} features; expected ${expected}: ${path}" >&2
    exit 1
  fi
}

validate_overview_build_inputs() {
  echo "[build-overview] overview validation (build inputs)..." >&2

  local missing=()
  local f
  for f in \
    "${NE}/land.geojsonseq" \
    "${NE}/ocean.geojsonseq" \
    "${NE}/coastline.geojsonseq" \
    "${NE}/countries.geojsonseq" \
    "${NE}/country_boundaries.geojsonseq" \
    "${NE}/populated_places.geojsonseq" \
    "${NE}/lakes.geojsonseq" \
    "${NE}/rivers.geojsonseq" \
    "$MYANMAR_COUNTRY" \
    "$MYANMAR_STATE" \
    "$MYANMAR_LABELS"
  do
    if [[ ! -f "$f" ]]; then
      missing+=("$f")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "error: missing ${#missing[@]} overview build input(s):" >&2
    for f in "${missing[@]}"; do
      echo "  - $f" >&2
    done
    if [[ ! -f "$MYANMAR_COUNTRY" ]]; then
      echo "  hint: npm run tiles:export:overview-admin" >&2
    fi
    if [[ ! -f "${NE}/land.geojsonseq" ]]; then
      echo "  hint: bash infrastructure/tiles/scripts/clip-natural-earth-overview.sh" >&2
    fi
    exit 1
  fi

  if [[ -d "${DATA}/mimu" ]]; then
    echo "error: active overview build must not use ${DATA}/mimu" >&2
    exit 1
  fi

  require_geojsonseq_count "$MYANMAR_COUNTRY" 1 "myanmar_country"
  require_geojsonseq_count "$MYANMAR_STATE" 15 "myanmar_state_region"
  require_geojsonseq_count "$MYANMAR_LABELS" 15 "myanmar_state_labels"

  echo "[build-overview] inputs OK (version=${VERSION})" >&2
  echo "  myanmar_country: ${MYANMAR_COUNTRY} (1)" >&2
  echo "  myanmar_state_region: ${MYANMAR_STATE} (15)" >&2
  echo "  myanmar_state_labels: ${MYANMAR_LABELS} (15)" >&2
}

validate_overview_build_inputs

if [[ "${VALIDATE_ONLY:-0}" == "1" ]]; then
  echo "[build-overview] VALIDATE_ONLY=1 — skipping tippecanoe" >&2
  BUILD_OK=1
  exit 0
fi

command -v tippecanoe >/dev/null 2>&1 || { echo "error: tippecanoe required" >&2; exit 1; }
command -v tile-join >/dev/null 2>&1 || { echo "error: tile-join required" >&2; exit 1; }
command -v pmtiles >/dev/null 2>&1 || { echo "error: pmtiles required" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "error: python3 required" >&2; exit 1; }

mkdir -p "$OVERVIEW_DIR"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/overview-build.XXXXXX")"

BASE_MBTILES="${TMP_DIR}/base.mbtiles"
COUNTRY_MBTILES="${TMP_DIR}/myanmar_country.mbtiles"
STATE_MBTILES="${TMP_DIR}/myanmar_state.mbtiles"
LABELS_MBTILES="${TMP_DIR}/myanmar_state_labels.mbtiles"
MERGED_MBTILES="${TMP_DIR}/merged.mbtiles"

echo "[build-overview] tippecanoe build → ${OUTPUT_NEW}" >&2
echo "[build-overview] pass 1/5: Natural Earth context z0–z8" >&2

tippecanoe \
  -o "$BASE_MBTILES" \
  -Z0 -z8 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --coalesce \
  --simplify-only-low-zooms \
  --simplification=10 \
  --force \
  -L "land:${NE}/land.geojsonseq" \
  -L "ocean:${NE}/ocean.geojsonseq" \
  -L "coastline:${NE}/coastline.geojsonseq" \
  -L "countries:${NE}/countries.geojsonseq" \
  -L "country_boundaries:${NE}/country_boundaries.geojsonseq" \
  -L "populated_places:${NE}/populated_places.geojsonseq" \
  -L "lakes:${NE}/lakes.geojsonseq" \
  -L "rivers:${NE}/rivers.geojsonseq"

echo "[build-overview] pass 2/5: myanmar_country z0–z8 (minimal simplification)" >&2

tippecanoe \
  -o "$COUNTRY_MBTILES" \
  -Z0 -z8 \
  --no-line-simplification \
  --no-simplification-of-shared-nodes \
  --simplification=1 \
  --full-detail=8 \
  --no-tile-size-limit \
  --no-feature-limit \
  --force \
  -L "myanmar_country:${MYANMAR_COUNTRY}"

echo "[build-overview] pass 3/5: myanmar_state_region polygons z4–z8" >&2

tippecanoe \
  -o "$STATE_MBTILES" \
  -Z4 -z8 \
  --no-simplification-of-shared-nodes \
  --simplification=4 \
  --full-detail=8 \
  --no-tile-size-limit \
  --no-feature-limit \
  --force \
  -L "myanmar_state_region:${MYANMAR_STATE}"

# Dedicated 15-point pass: -r1 keeps every label at every zoom (default drop-rate
# previously left only ~2 labels at z4 and ~7 at z6).
echo "[build-overview] pass 4/5: myanmar_state_labels z4–z8 (-r1, no density drop)" >&2

tippecanoe \
  -o "$LABELS_MBTILES" \
  -Z4 -z8 \
  -r1 \
  --no-feature-limit \
  --no-tile-size-limit \
  --force \
  -L "myanmar_state_labels:${MYANMAR_LABELS}"

echo "[build-overview] pass 5/5: tile-join + PMTiles conversion" >&2

tile-join -o "$MERGED_MBTILES" "$BASE_MBTILES" "$COUNTRY_MBTILES" "$STATE_MBTILES" "$LABELS_MBTILES"
pmtiles convert "$MERGED_MBTILES" "$OUTPUT_NEW"

echo "[build-overview] verifying new archive metadata before replace..." >&2
python3 "${SCRIPT_DIR}/validate-overview-pmtiles-metadata.py" "$OUTPUT_NEW"

# Guard: all 15 state labels must be present at native overview zooms (not only z8).
python3 - "$LABELS_MBTILES" <<'PY'
import json, subprocess, sys
from collections import defaultdict

mbtiles = sys.argv[1]
data = json.loads(
    subprocess.check_output(
        ["tippecanoe-decode", "-z", "8", "-Z", "4", mbtiles],
        text=True,
        stderr=subprocess.DEVNULL,
    )
)
by_z = defaultdict(set)
for tile in data.get("features", []):
    z = tile.get("properties", {}).get("zoom")
    for layer_fc in tile.get("features") or []:
        if (layer_fc.get("properties") or {}).get("layer") != "myanmar_state_labels":
            continue
        for feat in layer_fc.get("features") or []:
            cid = (feat.get("properties") or {}).get("core_id")
            if cid is not None:
                by_z[z].add(cid)

bad = []
for z in range(4, 9):
    n = len(by_z[z])
    print(f"[build-overview] myanmar_state_labels @ z{z}: {n}/15", file=sys.stderr)
    if n != 15:
        bad.append(f"z{z}={n}")
if bad:
    raise SystemExit(
        "myanmar_state_labels density drop detected (expected 15 at z4–z8): " + ", ".join(bad)
    )
print("[build-overview] myanmar_state_labels: 15/15 present at z4–z8", file=sys.stderr)
PY

BASE_URL="${BASE_URL:-http://localhost:8080}"
BASE_URL="${BASE_URL%/}"
URL="${BASE_URL}/overview/regions/${FILENAME}"

python3 - "$CURRENT_NEW" "$VERSION" "$FILENAME" "$URL" <<'PY'
import json, sys
from pathlib import Path

out, version, filename, url = sys.argv[1:5]
doc = {
    "region": "overview",
    "type": "overview",
    "version": version,
    "filename": filename,
    "url": url,
    "minZoom": 0,
    "maxZoom": 8,
    "nativeMaxZoom": 8,
    "center": [96.2, 20.5],
    "initialZoom": 4.7,
    "minMapZoom": 4.3,
    "maxBounds": [[78.0, 3.0], [112.0, 34.0]],
    "layers": [
        "land",
        "ocean",
        "coastline",
        "countries",
        "country_boundaries",
        "populated_places",
        "lakes",
        "rivers",
        "myanmar_country",
        "myanmar_state_region",
        "myanmar_state_labels",
    ],
    "notes": {
        "myanmarNationalShape": "myanmar_country from tile_source.admin_areas country row",
        "mimu": "not used",
        "overzoom": "native z8 tiles overzoom in MapLibre through camera z20",
        "geometry": "temporary country geom may be imperfect; replace in Supabase then tiles:sync + rebuild v2",
    },
}
Path(out).write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
PY

echo "[build-overview] atomic replace → ${OUTPUT}" >&2
mv -f "$OUTPUT_NEW" "$OUTPUT"
mv -f "$CURRENT_NEW" "$CURRENT_JSON"

echo "[build-overview] layer summary:" >&2
pmtiles show "$OUTPUT" 2>&1 | head -40 >&2 || true

BUILD_OK=1
echo "[build-overview] SUCCESS: ${OUTPUT}" >&2
echo "[build-overview] current.json=${CURRENT_JSON}" >&2
