#!/usr/bin/env bash
# Validate local tile_source.admin_areas for overview admin export.
# Read-only. Does not query Supabase, repair data, or build tiles.
#
# Checks:
#   - exactly 1 active country with valid polygon geom + label fallback
#   - packages.yaml allowlist resolves to exactly 15 unique state_region rows
#   - each official package member is state_region and resolves to one boundary
#   - selected rows have valid non-empty polygon geom + label fallback
#
# Usage:
#   npm run tiles:validate:overview-source
#   bash infrastructure/tiles/pmtiles/scripts/validate-overview-source.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-root-env.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/region-resolver.sh"

command -v psql >/dev/null 2>&1 || { echo "FAIL: psql required" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: python3 required" >&2; exit 1; }

if [[ -z "${LOCAL_TILE_DATABASE_URL:-}" ]]; then
  echo "FAIL: LOCAL_TILE_DATABASE_URL is not set (local coremap_tiles required)." >&2
  exit 1
fi

if [[ "${LOCAL_TILE_DATABASE_URL}" == *supabase* || "${LOCAL_TILE_DATABASE_URL}" == *pooler.supabase* ]]; then
  echo "FAIL: LOCAL_TILE_DATABASE_URL must be local coremap_tiles, not Supabase." >&2
  exit 1
fi

LOCAL_TILE_DATABASE_URL="$(local_map_clean_pg_url "$LOCAL_TILE_DATABASE_URL")"
export LOCAL_TILE_DATABASE_URL
local_map_log_local_tile_database_url_host

if [[ "$(python3 "$PMTILES_PACKAGE_CONFIG_PY" list | wc -w | tr -d ' ')" -ne 15 ]]; then
  echo "FAIL: packages.yaml must define exactly 15 official packages for overview admin." >&2
  exit 1
fi

declare -a SELECTED_CORE_IDS=()
declare -a PACKAGE_KEYS_USED=()

echo "[validate-overview-source] resolving packages.yaml allowlist..." >&2

for package_key in "${PMTILES_SUPPORTED_REGIONS[@]}"; do
  members_json="$(python3 "$PMTILES_PACKAGE_CONFIG_PY" members-json "$package_key")"
  member_count="$(python3 -c 'import json,sys; print(len(json.loads(sys.argv[1])))' "$members_json")"
  if [[ "$member_count" -ne 1 ]]; then
    echo "FAIL: package '${package_key}' must resolve to exactly one state/region member (got ${member_count})." >&2
    exit 1
  fi

  while IFS= read -r member; do
    [[ -z "$member" ]] && continue
    admin_level="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("admin_level") or "")' "$member")"
    name_en="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("name_en") or "")' "$member")"
    name_mm="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("name_mm") or "")' "$member")"
    core_id="$(python3 -c 'import json,sys; v=json.loads(sys.argv[1]).get("core_id"); print("" if v is None else v)' "$member")"

    if [[ "$admin_level" != "state_region" ]]; then
      echo "FAIL: package '${package_key}' member admin_level must be state_region (got '${admin_level}')." >&2
      exit 1
    fi

    row="$(pmtiles_resolve_package_member "$admin_level" "$name_en" "$name_mm" "$core_id")" || {
      echo "FAIL: package '${package_key}' did not resolve to exactly one state/region boundary." >&2
      exit 1
    }
    IFS='|' read -r mid _mname _area <<<"$row"
    if [[ -z "$mid" ]]; then
      echo "FAIL: package '${package_key}' resolved with empty core_id." >&2
      exit 1
    fi
    SELECTED_CORE_IDS+=("$mid")
    PACKAGE_KEYS_USED+=("$package_key")
  done < <(python3 -c 'import json,sys; [print(json.dumps(m, ensure_ascii=False)) for m in json.loads(sys.argv[1])]' "$members_json")
done

SELECTED_COUNT="${#SELECTED_CORE_IDS[@]}"
UNIQUE_COUNT="$(printf '%s\n' "${SELECTED_CORE_IDS[@]}" | sed '/^$/d' | sort -n -u | wc -l | tr -d ' ')"

if [[ "$SELECTED_COUNT" -ne 15 ]]; then
  echo "FAIL: allowlist resolved ${SELECTED_COUNT} members; expected 15." >&2
  exit 1
fi

if [[ "$UNIQUE_COUNT" -ne 15 ]]; then
  echo "FAIL: selected state_region core_id values are not unique (${UNIQUE_COUNT}/15 unique)." >&2
  printf '  core_ids: %s\n' "$(printf '%s,' "${SELECTED_CORE_IDS[@]}" | sed 's/,$//')" >&2
  exit 1
fi

UNIQUE_IDS_CSV="$(
  printf '%s\n' "${SELECTED_CORE_IDS[@]}" \
    | sed '/^$/d' \
    | sort -n -u \
    | paste -sd, -
)"

echo "[validate-overview-source] checking tile_source.admin_areas country + selected state_region..." >&2

# UNIQUE_IDS_CSV is digits + commas only (from resolver); safe to embed.
psql "$LOCAL_TILE_DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
\\pset pager off
\\set ON_ERROR_STOP on

DO \$\$
DECLARE
  failures text[] := ARRAY[]::text[];
  selected_ids bigint[] := ARRAY[${UNIQUE_IDS_CSV}]::bigint[];
  n bigint;
  n2 bigint;
  bad text;
BEGIN
  IF to_regclass('tile_source.admin_areas') IS NULL THEN
    RAISE EXCEPTION 'tile_source.admin_areas missing — apply migration 023 and run tiles:sync for admin_areas';
  END IF;

  -- COUNTRY: exactly 1 active
  SELECT count(*)::bigint INTO n
  FROM tile_source.admin_areas AS a
  WHERE a.admin_level_code = 'country'
    AND a.is_active IS TRUE
    AND a.deleted_at IS NULL;

  IF n <> 1 THEN
    failures := array_append(failures,
      format('country count must be exactly 1 (got %s)', n));
  END IF;

  -- COUNTRY: non-empty polygon that is valid OR make-valid-able + core_id + label
  SELECT count(*)::bigint INTO n
  FROM tile_source.admin_areas AS a
  WHERE a.admin_level_code = 'country'
    AND a.is_active IS TRUE
    AND a.deleted_at IS NULL
    AND a.core_id IS NOT NULL
    AND a.geom IS NOT NULL
    AND NOT ST_IsEmpty(a.geom)
    AND ST_GeometryType(a.geom) IN ('ST_Polygon', 'ST_MultiPolygon')
    AND ST_SRID(a.geom) IN (0, 4326)
    AND ST_IsValid(ST_MakeValid(a.geom))
    AND NOT ST_IsEmpty(ST_MakeValid(a.geom))
    AND coalesce(
          nullif(btrim(a.name_mm), ''),
          nullif(btrim(a.name), ''),
          nullif(btrim(a.name_en), '')
        ) IS NOT NULL;

  IF n <> 1 THEN
    failures := array_append(failures,
      'country row must have core_id, non-empty Polygon/MultiPolygon (valid or make-valid-able), SRID 4326, and a label from name_mm/name/name_en');
  END IF;

  -- STATE_REGION: allowlist ids exist as exactly 15 valid official rows
  SELECT count(*)::bigint INTO n
  FROM tile_source.admin_areas AS a
  WHERE a.core_id = ANY (selected_ids)
    AND a.admin_level_code = 'state_region'
    AND a.is_active IS TRUE
    AND a.deleted_at IS NULL;

  IF n <> 15 THEN
    failures := array_append(failures,
      format('official allowlist matched %s active state_region rows; expected 15', n));
  END IF;

  SELECT count(DISTINCT a.core_id)::bigint INTO n2
  FROM tile_source.admin_areas AS a
  WHERE a.core_id = ANY (selected_ids)
    AND a.admin_level_code = 'state_region'
    AND a.is_active IS TRUE
    AND a.deleted_at IS NULL;

  IF n2 <> 15 THEN
    failures := array_append(failures,
      format('official allowlist core_id uniqueness failed (%s distinct)', n2));
  END IF;

  SELECT count(*)::bigint INTO n
  FROM tile_source.admin_areas AS a
  WHERE a.core_id = ANY (selected_ids)
    AND a.admin_level_code = 'state_region'
    AND a.is_active IS TRUE
    AND a.deleted_at IS NULL
    AND a.core_id IS NOT NULL
    AND a.geom IS NOT NULL
    AND NOT ST_IsEmpty(a.geom)
    AND ST_GeometryType(a.geom) IN ('ST_Polygon', 'ST_MultiPolygon')
    AND ST_IsValid(ST_MakeValid(a.geom))
    AND NOT ST_IsEmpty(ST_MakeValid(a.geom))
    AND coalesce(
          nullif(btrim(a.name_mm), ''),
          nullif(btrim(a.name), ''),
          nullif(btrim(a.name_en), '')
        ) IS NOT NULL;

  IF n <> 15 THEN
    failures := array_append(failures,
      format(
        'official state_region rows with usable polygon geom + label fallback: %s/15',
        n
      ));
  END IF;

  -- LABELS: one usable point per official state (admin_labels or PointOnSurface)
  SELECT count(*)::bigint INTO n
  FROM tile_source.admin_areas AS a
  WHERE a.core_id = ANY (selected_ids)
    AND a.admin_level_code = 'state_region'
    AND a.is_active IS TRUE
    AND a.deleted_at IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM tile_source.admin_labels l
        WHERE l.core_id = a.core_id
          AND l.admin_level_code = 'state_region'
          AND l.geom IS NOT NULL
          AND NOT ST_IsEmpty(l.geom)
      )
      OR (
        a.geom IS NOT NULL
        AND NOT ST_IsEmpty(a.geom)
        AND ST_GeometryType(ST_PointOnSurface(ST_MakeValid(a.geom))) = 'ST_Point'
      )
    );

  IF n <> 15 THEN
    failures := array_append(failures,
      format('usable state label points (admin_labels or PointOnSurface): %s/15', n));
  END IF;

  SELECT string_agg(a.core_id::text, ', ' ORDER BY a.core_id) INTO bad
  FROM tile_source.admin_areas AS a
  WHERE a.core_id = ANY (selected_ids)
    AND a.admin_level_code = 'state_region'
    AND a.is_active IS TRUE
    AND a.deleted_at IS NULL
    AND (
      a.core_id IS NULL
      OR a.geom IS NULL
      OR ST_IsEmpty(a.geom)
      OR ST_GeometryType(a.geom) NOT IN ('ST_Polygon', 'ST_MultiPolygon')
      OR NOT ST_IsValid(ST_MakeValid(a.geom))
      OR ST_IsEmpty(ST_MakeValid(a.geom))
      OR coalesce(
            nullif(btrim(a.name_mm), ''),
            nullif(btrim(a.name), ''),
            nullif(btrim(a.name_en), '')
          ) IS NULL
    );

  IF bad IS NOT NULL THEN
    failures := array_append(failures,
      format('selected state_region core_id(s) failed geom/label checks: %s', bad));
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE NOTICE 'VALIDATE-OVERVIEW-SOURCE FAIL (%s checks)', cardinality(failures);
    FOR n IN 1 .. cardinality(failures) LOOP
      RAISE NOTICE '  - %', failures[n];
    END LOOP;
    RAISE EXCEPTION 'validate-overview-source FAILED with % error(s)', cardinality(failures);
  END IF;

  RAISE NOTICE 'VALIDATE-OVERVIEW-SOURCE PASS (country=1, official state_region=15)';
END \$\$;
SQL

echo "PASS" >&2
echo "[validate-overview-source] packages: ${PACKAGE_KEYS_USED[*]}" >&2
echo "[validate-overview-source] core_ids: ${UNIQUE_IDS_CSV}" >&2
