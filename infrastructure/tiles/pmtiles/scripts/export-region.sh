#!/usr/bin/env bash
# Export basemap GeoJSON from local coremap_tiles (tile_source.*) for PMTiles builds.
# Writes into exports/<region>/ (clean folder each run).
#
# Architecture:
#   Supabase -> tiles:sync -> Windows coremap_tiles -> export (this script) -> tippecanoe
#
# After tiles:sync, export/build must not depend on Supabase or the internet.
# Requires: LOCAL_TILE_DATABASE_URL
#
# Regional exports are spatially filtered to the state/region polygon plus a
# configurable buffer (default 10 km).
#
# Usage:
#   bash infrastructure/tiles/pmtiles/scripts/export-region.sh <region> <version>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-root-env.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/region-resolver.sh"

if [[ -f "${SCRIPT_DIR}/build-stages.sh" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/build-stages.sh"
  export PMTILES_PIPELINE_SCOPE="${PMTILES_PIPELINE_SCOPE:-export}"
  if [[ -z "${PMTILES_PIPELINE_STARTED_AT:-}" ]]; then
    export PMTILES_PIPELINE_STARTED_AT="$(date +%s)"
    export PMTILES_STAGE_STARTED_AT="$PMTILES_PIPELINE_STARTED_AT"
  fi
fi

if [[ -z "${LOCAL_TILE_DATABASE_URL:-}" ]]; then
  echo "error: LOCAL_TILE_DATABASE_URL is not set (local coremap_tiles required)." >&2
  echo "  export LOCAL_TILE_DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/coremap_tiles'" >&2
  exit 1
fi

if [[ "${LOCAL_TILE_DATABASE_URL}" == *supabase* || "${LOCAL_TILE_DATABASE_URL}" == *pooler.supabase* ]]; then
  echo "error: LOCAL_TILE_DATABASE_URL must be local coremap_tiles, not Supabase." >&2
  exit 1
fi

LOCAL_TILE_DATABASE_URL="$(local_map_clean_pg_url "$LOCAL_TILE_DATABASE_URL")"
export LOCAL_TILE_DATABASE_URL
local_map_log_local_tile_database_url_host

if [[ $# -lt 2 ]]; then
  echo "usage: bash infrastructure/tiles/pmtiles/scripts/export-region.sh <region> <version>" >&2
  echo "supported regions: $(pmtiles_region_list_supported)" >&2
  exit 1
fi

command -v python3 >/dev/null 2>&1 || { echo "error: python3 required" >&2; exit 1; }
command -v ogr2ogr >/dev/null 2>&1 || { echo "error: ogr2ogr required (brew install gdal)" >&2; exit 1; }
command -v ogrinfo >/dev/null 2>&1 || { echo "error: ogrinfo required (brew install gdal)" >&2; exit 1; }
VALIDATE_GEOJSON_PY="${SCRIPT_DIR}/validate-geojson.py"
command -v psql >/dev/null 2>&1 || { echo "error: psql required" >&2; exit 1; }

REGION="$1"
VERSION="$2"
PMTILES_REGION_BUFFER_METERS="${PMTILES_REGION_BUFFER_METERS:-10000}"
PMTILES_REGION_SUBDIVIDE_SEGMENTS="${PMTILES_REGION_SUBDIVIDE_SEGMENTS:-512}"
PMTILES_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUT="${PMTILES_ROOT}/exports/${REGION}"
PLANNED_PMTILES="${PMTILES_ROOT}/regions/${REGION}/${REGION}-${VERSION}.pmtiles"

if ! pmtiles_region_is_supported "$REGION"; then
  echo "error: unsupported region '${REGION}'. Supported: $(pmtiles_region_list_supported)" >&2
  exit 1
fi

BOUNDARY_INFO="$(pmtiles_resolve_region_boundary "$REGION")" || exit 1
IFS='|' read -r REGION_ADMIN_AREA_ID REGION_BOUNDARY_NAME REGION_AREA_KM2 REGION_MEMBER_COUNT <<<"$BOUNDARY_INFO"

echo "" >&2
echo "[export] region=${REGION} version=${VERSION}" >&2
echo "[export] source=LOCAL_TILE_DATABASE_URL (tile_source.* only; no Supabase)" >&2
echo "[export] boundary core_ids=${REGION_ADMIN_AREA_ID} members=${REGION_MEMBER_COUNT:-1} name=${REGION_BOUNDARY_NAME} area_km2=${REGION_AREA_KM2}" >&2
echo "[export] clip buffer=${PMTILES_REGION_BUFFER_METERS}m (PMTILES_REGION_BUFFER_METERS)" >&2
echo "[export] subdivide segments=${PMTILES_REGION_SUBDIVIDE_SEGMENTS} (PMTILES_REGION_SUBDIVIDE_SEGMENTS)" >&2
echo "[export] output=${OUT}/" >&2
echo "[export] planned PMTiles=${PLANNED_PMTILES}" >&2
echo "" >&2

# geojson_basename|relation_or_special|distinct_key
# Keep MapLibre source-layer file names (road_labels, admin_boundaries, admin_area_label_points).
declare -a LAYERS=(
  "buildings|tile_source.buildings_v|feature_key"
  "streets|tile_source.streets|core_id"
  "road_labels|__road_labels__|id"
  "water_polygons|tile_source.water_polygons|core_id"
  "water_lines|tile_source.water_lines|core_id"
  "landuse|tile_source.land_areas_v|feature_key"
  "admin_boundaries|tile_source.admin_areas|core_id"
  "admin_areas|tile_source.admin_areas|core_id"
  "admin_area_label_points|tile_source.admin_labels|core_id"
  "settlements|tile_source.settlements|core_id"
  "coastlines|tile_source.coastlines|core_id"
  "protected_areas|tile_source.protected_areas|core_id"
)

rm -rf "$OUT"
mkdir -p "$OUT"

if declare -F pmtiles_stage >/dev/null 2>&1; then
  pmtiles_stage 2.00 "export: clean folder ready"
fi

export_geojson_feature_count() {
  python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1], encoding="utf-8")).get("features", [])))' "$1"
}

export_geojson_human_size() {
  ls -lh "$1" | awk '{print $5}'
}

export_layer_sql() {
  local relation="$1"
  local distinct_key="$2"
  if [[ "$relation" == "__road_labels__" ]]; then
    local boundary_ctes
    boundary_ctes="$(pmtiles_region_boundary_ctes_sql "$REGION_ADMIN_AREA_ID" "$PMTILES_REGION_BUFFER_METERS" "$PMTILES_REGION_SUBDIVIDE_SEGMENTS")"
    cat <<SQL
WITH ${boundary_ctes},
layer AS (
  SELECT
    s.core_id AS id,
    s.name,
    s.name_mm,
    s.name_en,
    s.road_class_code,
    s.min_zoom,
    s.geom,
    'road_label'::text AS layer_type
  FROM tile_source.streets AS s
  WHERE s.name IS NOT NULL
    AND btrim(s.name) <> ''
    AND s.geom IS NOT NULL
    AND NOT st_isempty(s.geom)
    AND s.is_active IS TRUE
    AND s.deleted_at IS NULL
)
SELECT DISTINCT ON (layer.id) layer.*
FROM layer
INNER JOIN region_parts AS rp
  ON layer.geom && rp.part_geom
 AND st_intersects(layer.geom, rp.part_geom)
ORDER BY layer.id
SQL
    return 0
  fi

  pmtiles_clipped_relation_sql "$relation" "$distinct_key" \
    "$REGION_ADMIN_AREA_ID" "$PMTILES_REGION_BUFFER_METERS" "$PMTILES_REGION_SUBDIVIDE_SEGMENTS"
}

export PGOPTIONS="${PGOPTIONS:--c statement_timeout=3600000}"

layer_index=0
layer_total="${#LAYERS[@]}"
for entry in "${LAYERS[@]}"; do
  layer_index=$((layer_index + 1))
  IFS='|' read -r base relation distinct_key <<<"$entry"
  dest="${OUT}/${base}.geojson"
  clip_sql="$(export_layer_sql "$relation" "$distinct_key")"

  if declare -F pmtiles_stage >/dev/null 2>&1; then
    pct="$(awk -v i="$layer_index" -v t="$layer_total" 'BEGIN { printf "%.2f", 3.0 + (i / t) * 22.0 }')"
    pmtiles_stage "$pct" "export layer ${layer_index}/${layer_total}: ${base} <- ${relation} (clipped)"
  else
    echo "[export] layer: ${base}.geojson <- ${relation} (clipped)" >&2
  fi

  ogr2ogr -overwrite -f GeoJSON "$dest" "PG:${LOCAL_TILE_DATABASE_URL}" \
    -sql "${clip_sql}" \
    -s_srs EPSG:4326 \
    -t_srs EPSG:4326

  python3 "$VALIDATE_GEOJSON_PY" "$dest" || {
    echo "error: invalid GeoJSON: ${dest}" >&2
    exit 1
  }

  feature_n="$(export_geojson_feature_count "$dest")"
  file_size="$(export_geojson_human_size "$dest")"
  echo "[export] clipped ${base}: ${feature_n} features, ${file_size}" >&2
done

if declare -F pmtiles_stage >/dev/null 2>&1; then
  pmtiles_stage 25.00 "export complete (ready for tiles:build)"
fi

echo "[export] SUCCESS: ${layer_total} clipped layers exported to ${OUT}/" >&2
