# shellcheck shell=bash
# PMTiles package key → local tile_source.admin_areas boundary resolver.
# Sourced by export-region.sh, rebuild-all-regions.sh, and build-all-regions.sh.
#
# Requires LOCAL_TILE_DATABASE_URL (Windows coremap_tiles). No Supabase at export time.
# Package definitions live in config/packages.yaml (one or more admin members per package).

_PMTILES_RESOLVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PMTILES_PACKAGE_CONFIG_PY="${_PMTILES_RESOLVER_DIR}/package-config.py"

# Populate supported package keys from packages.yaml (compatible name kept).
mapfile -t PMTILES_SUPPORTED_REGIONS < <(
  python3 "$PMTILES_PACKAGE_CONFIG_PY" list | tr ' ' '\n' | sed '/^$/d'
)

pmtiles_region_is_supported() {
  local key="$1"
  python3 "$PMTILES_PACKAGE_CONFIG_PY" exists "$key" >/dev/null
}

pmtiles_region_list_supported() {
  local IFS=', '
  echo "${PMTILES_SUPPORTED_REGIONS[*]}"
}

# Escape single quotes for SQL string literals.
pmtiles_sql_quote() {
  printf "%s" "$1" | sed "s/'/''/g"
}

# Resolve one package member to exactly one admin row; prints "core_id|name|area_km2".
pmtiles_resolve_package_member() {
  local admin_level="$1"
  local name_en="${2:-}"
  local name_mm="${3:-}"
  local core_id="${4:-}"
  local level_q name_en_q name_mm_q
  local where_parts=()

  if [[ -z "${LOCAL_TILE_DATABASE_URL:-}" ]]; then
    echo "error: LOCAL_TILE_DATABASE_URL is not set (local coremap_tiles required for export)." >&2
    return 1
  fi

  level_q="$(pmtiles_sql_quote "$admin_level")"
  where_parts+=("a.admin_level_code = '${level_q}'")
  where_parts+=("a.is_active IS TRUE")
  where_parts+=("a.deleted_at IS NULL")
  where_parts+=("a.geom IS NOT NULL")
  where_parts+=("NOT st_isempty(a.geom)")
  where_parts+=("st_isvalid(a.geom)")

  if [[ -n "$core_id" ]]; then
    where_parts+=("a.core_id = ${core_id}")
  fi

  local name_preds=()
  if [[ -n "$name_en" ]]; then
    name_en_q="$(pmtiles_sql_quote "$name_en")"
    name_preds+=("lower(trim(coalesce(a.name_en, ''))) = lower('${name_en_q}')")
    name_preds+=("lower(trim(coalesce(a.name, ''))) = lower('${name_en_q}')")
  fi
  if [[ -n "$name_mm" ]]; then
    name_mm_q="$(pmtiles_sql_quote "$name_mm")"
    # Strip zero-width space (U+200B) seen in some synced Myanmar names.
    name_preds+=("replace(trim(coalesce(a.name_mm, '')), chr(8203), '') = '${name_mm_q}'")
    name_preds+=("replace(trim(coalesce(a.name, '')), chr(8203), '') = '${name_mm_q}'")
  fi
  if [[ ${#name_preds[@]} -gt 0 ]]; then
    local joined=""
    local j
    for j in "${!name_preds[@]}"; do
      if [[ "$j" -gt 0 ]]; then
        joined+=" OR "
      fi
      joined+="${name_preds[$j]}"
    done
    where_parts+=("(${joined})")
  fi

  local where_sql=""
  local i
  for i in "${!where_parts[@]}"; do
    if [[ "$i" -gt 0 ]]; then
      where_sql+=" AND "
    fi
    where_sql+="${where_parts[$i]}"
  done

  local result
  result="$(
    psql "$LOCAL_TILE_DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -F '|' -c "
SELECT
  a.core_id::text,
  coalesce(nullif(btrim(a.name_en), ''), nullif(btrim(a.name_mm), ''), nullif(btrim(a.name), ''), a.core_id::text),
  round((st_area(a.geom::geography) / 1e6)::numeric, 1)::text
FROM tile_source.admin_areas AS a
WHERE ${where_sql}
ORDER BY st_area(a.geom::geography) DESC
LIMIT 2;
"
  )"

  if [[ -z "$result" ]]; then
    echo "error: admin member not found (level=${admin_level} name_en='${name_en}' name_mm='${name_mm}' core_id='${core_id}')." >&2
    echo "error: run tiles:sync for admin_areas, and use exact names (no fuzzy Wa/extra state_region matches)." >&2
    return 1
  fi

  local row_count
  row_count="$(printf '%s\n' "$result" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [[ "$row_count" -gt 1 ]]; then
    echo "error: admin member matched ${row_count} rows (expected exactly 1):" >&2
    printf '%s\n' "$result" | while IFS='|' read -r id name area; do
      echo "  - core_id=${id} name=${name} area_km2=${area}" >&2
    done
    return 1
  fi

  printf '%s' "$result" | head -n 1
}

# Resolve package key to combined boundary; prints "core_ids_csv|label|area_km2|member_count".
pmtiles_resolve_region_boundary() {
  local package_key="$1"
  local label members_json
  local -a core_ids=()
  local -a member_names=()

  if ! pmtiles_region_is_supported "$package_key"; then
    echo "error: unsupported package key '${package_key}'. Supported: $(pmtiles_region_list_supported)" >&2
    return 1
  fi

  if [[ -z "${LOCAL_TILE_DATABASE_URL:-}" ]]; then
    echo "error: LOCAL_TILE_DATABASE_URL is not set (local coremap_tiles required for export)." >&2
    return 1
  fi

  label="$(python3 "$PMTILES_PACKAGE_CONFIG_PY" label "$package_key")"
  members_json="$(python3 "$PMTILES_PACKAGE_CONFIG_PY" members-json "$package_key")"

  while IFS= read -r member; do
    [[ -z "$member" ]] && continue
    local admin_level name_en name_mm core_id row
    admin_level="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("admin_level") or "")' "$member")"
    name_en="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("name_en") or "")' "$member")"
    name_mm="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("name_mm") or "")' "$member")"
    core_id="$(python3 -c 'import json,sys; v=json.loads(sys.argv[1]).get("core_id"); print("" if v is None else v)' "$member")"
    row="$(pmtiles_resolve_package_member "$admin_level" "$name_en" "$name_mm" "$core_id")" || return 1
    IFS='|' read -r mid mname _area <<<"$row"
    core_ids+=("$mid")
    member_names+=("$mname")
  done < <(python3 -c 'import json,sys; [print(json.dumps(m, ensure_ascii=False)) for m in json.loads(sys.argv[1])]' "$members_json")

  if [[ ${#core_ids[@]} -eq 0 ]]; then
    echo "error: package '${package_key}' resolved zero admin members" >&2
    return 1
  fi

  local ids_csv names_joined area_km2
  ids_csv="$(IFS=','; echo "${core_ids[*]}")"
  names_joined="$(IFS='+'; echo "${member_names[*]}")"
  area_km2="$(
    psql "$LOCAL_TILE_DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "
SELECT round((st_area(st_unaryunion(st_collect(st_makevalid(a.geom)))::geography) / 1e6)::numeric, 1)::text
FROM tile_source.admin_areas AS a
WHERE a.core_id IN (${ids_csv});
"
  )"

  printf '%s|%s|%s|%s' "$ids_csv" "${label:-$names_joined}" "$area_km2" "${#core_ids[@]}"
}

# Combined package boundary + subdivided parts CTEs (one or many admin core_ids).
pmtiles_region_boundary_ctes_sql() {
  local admin_area_ids_csv="$1"
  local buffer_meters="$2"
  local subdivide_segments="${3:-512}"
  cat <<SQL
region_members AS (
  SELECT st_makevalid(a.geom) AS geom
  FROM tile_source.admin_areas AS a
  WHERE a.core_id IN (${admin_area_ids_csv})
),
region_boundary AS (
  SELECT
    st_setsrid(
      st_buffer(
        st_unaryunion(st_collect(rm.geom))::geography,
        ${buffer_meters}::double precision
      )::geometry,
      4326
    ) AS geom
  FROM region_members AS rm
),
region_parts AS (
  SELECT
    (st_dump(st_subdivide(rb.geom, ${subdivide_segments}))).geom AS part_geom
  FROM region_boundary AS rb
)
SQL
}

# Clipped SELECT for a local relation (schema.table or subquery alias).
# distinct_key: feature_key | core_id | id
# admin_area_id may be a single id or comma-separated ids.
pmtiles_clipped_relation_sql() {
  local relation="$1"
  local distinct_key="$2"
  local admin_area_ids_csv="$3"
  local buffer_meters="$4"
  local subdivide_segments="${5:-512}"
  local boundary_ctes
  boundary_ctes="$(pmtiles_region_boundary_ctes_sql "$admin_area_ids_csv" "$buffer_meters" "$subdivide_segments")"
  cat <<SQL
WITH ${boundary_ctes}
SELECT DISTINCT ON (layer.${distinct_key}) layer.*
FROM ${relation} AS layer
INNER JOIN region_parts AS rp
  ON layer.geom && rp.part_geom
 AND st_intersects(layer.geom, rp.part_geom)
WHERE layer.geom IS NOT NULL
  AND NOT st_isempty(layer.geom)
ORDER BY layer.${distinct_key}
SQL
}

# Backward-compatible wrapper (legacy tiles.* view name + id column).
pmtiles_clipped_layer_sql() {
  local view_name="$1"
  local admin_area_id="$2"
  local buffer_meters="$3"
  local subdivide_segments="${4:-512}"
  pmtiles_clipped_relation_sql "tiles.${view_name}" "id" "$admin_area_id" "$buffer_meters" "$subdivide_segments"
}

# Count features that would be exported for a local relation.
pmtiles_clipped_relation_count() {
  local relation="$1"
  local distinct_key="$2"
  local admin_area_ids_csv="$3"
  local buffer_meters="$4"
  local subdivide_segments="${5:-512}"
  local boundary_ctes
  boundary_ctes="$(pmtiles_region_boundary_ctes_sql "$admin_area_ids_csv" "$buffer_meters" "$subdivide_segments")"
  psql "$LOCAL_TILE_DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "
SET statement_timeout TO '3600000';
WITH ${boundary_ctes}
SELECT count(DISTINCT layer.${distinct_key})::bigint
FROM ${relation} AS layer
INNER JOIN region_parts AS rp
  ON layer.geom && rp.part_geom
 AND st_intersects(layer.geom, rp.part_geom)
WHERE layer.geom IS NOT NULL
  AND NOT st_isempty(layer.geom);
"
}

pmtiles_clipped_layer_count() {
  local view_name="$1"
  local admin_area_id="$2"
  local buffer_meters="$3"
  local subdivide_segments="${4:-512}"
  pmtiles_clipped_relation_count "tiles.${view_name}" "id" "$admin_area_id" "$buffer_meters" "$subdivide_segments"
}
