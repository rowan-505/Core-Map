#!/usr/bin/env bash
# Sync Supabase → local tile_source snapshots (Windows/WSL PMTiles machine).
#
# Required env (explicit — do not reuse one DATABASE_URL for both):
#   SUPABASE_DATABASE_URL
#   LOCAL_TILE_DATABASE_URL
#
# Pattern per dataset:
#   1) fetch into tile_source_staging.<dataset>  (live tables untouched)
#   2) validate staging
#   3) transactionally replace tile_source.<dataset>
# Failed sync leaves the previous good local snapshot intact.
#
# Does NOT touch:
#   tile_source.buildings_base
#   tile_source.land_areas_base
#   tile_source.buildings_archive
#   tile_source.land_areas_archive
#
# Usage:
#   SUPABASE_DATABASE_URL=... LOCAL_TILE_DATABASE_URL=... \
#     bash infrastructure/tiles/pmtiles/scripts/sync-supabase.sh
#   ... sync-supabase.sh streets settlements   # subset
#   npm run tiles:sync
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-root-env.sh"

SQL_DIR="${SCRIPT_DIR}/sync-sql"
STAGING_SCHEMA="tile_source_staging"

if [[ -z "${SUPABASE_DATABASE_URL:-}" ]]; then
  echo "error: SUPABASE_DATABASE_URL is required (Supabase source)." >&2
  exit 1
fi
if [[ -z "${LOCAL_TILE_DATABASE_URL:-}" ]]; then
  echo "error: LOCAL_TILE_DATABASE_URL is required (local coremap_tiles)." >&2
  exit 1
fi
if [[ "${LOCAL_TILE_DATABASE_URL}" == *supabase* || "${LOCAL_TILE_DATABASE_URL}" == *pooler.supabase* ]]; then
  echo "error: LOCAL_TILE_DATABASE_URL must be the local tile DB, not Supabase." >&2
  exit 1
fi
if [[ "${SUPABASE_DATABASE_URL}" != *supabase* && "${SUPABASE_DATABASE_URL}" != *pooler.supabase* ]]; then
  echo "warning: SUPABASE_DATABASE_URL does not look like a Supabase URL" >&2
fi

command -v psql >/dev/null 2>&1 || { echo "error: psql required" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "error: python3 required" >&2; exit 1; }

# Strip Prisma/pgbouncer-only query params that libpq rejects.
clean_pg_url() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse
raw = sys.argv[1]
u = urlparse(raw)
drop = {"pgbouncer", "connection_limit", "pool_timeout", "schema"}
qs = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if k.lower() not in drop]
print(urlunparse((u.scheme, u.netloc, u.path, u.params, urlencode(qs), u.fragment)))
PY
}

SUPABASE_DATABASE_URL="$(clean_pg_url "$SUPABASE_DATABASE_URL")"
LOCAL_TILE_DATABASE_URL="$(clean_pg_url "$LOCAL_TILE_DATABASE_URL")"

log_host() {
  local label="$1" url="$2"
  python3 - "$label" "$url" <<'PY'
import re, sys
label, url = sys.argv[1], sys.argv[2]
m = re.search(r"@([^@/?]+)(/|\?|$)", url)
host = m.group(1) if m else "(unparsed)"
print(f"[sync] {label} host: {host}", file=sys.stderr)
PY
}

log_host "supabase" "$SUPABASE_DATABASE_URL"
log_host "local" "$LOCAL_TILE_DATABASE_URL"

# dataset|local_table|extract_sql|min_rows
ALL_DATASETS=(
  "buildings_core|buildings_core|extract_buildings_core.sql|0"
  "land_areas_core|land_areas_core|extract_land_areas_core.sql|0"
  "buildings_suppressed|buildings_suppressed|extract_buildings_suppressed.sql|0"
  "land_areas_suppressed|land_areas_suppressed|extract_land_areas_suppressed.sql|0"
  "streets|streets|extract_streets.sql|1"
  "settlements|settlements|extract_settlements.sql|0"
  "admin_areas|admin_areas|extract_admin_areas.sql|1"
  "admin_labels|admin_labels|extract_admin_labels.sql|1"
  "water_lines|water_lines|extract_water_lines.sql|0"
  "water_polygons|water_polygons|extract_water_polygons.sql|0"
  "coastlines|coastlines|extract_coastlines.sql|0"
  "protected_areas|protected_areas|extract_protected_areas.sql|0"
)

SELECTED=()
if [[ $# -gt 0 ]]; then
  for arg in "$@"; do
    found=0
    for entry in "${ALL_DATASETS[@]}"; do
      ds="${entry%%|*}"
      if [[ "$ds" == "$arg" ]]; then
        SELECTED+=("$entry")
        found=1
        break
      fi
    done
    if [[ "$found" -eq 0 ]]; then
      echo "error: unknown dataset '$arg'" >&2
      echo "known: buildings_core land_areas_core buildings_suppressed land_areas_suppressed streets settlements admin_areas admin_labels water_lines water_polygons coastlines protected_areas" >&2
      exit 1
    fi
  done
else
  SELECTED=("${ALL_DATASETS[@]}")
fi

psql_local() {
  psql "$LOCAL_TILE_DATABASE_URL" -v ON_ERROR_STOP=1 "$@"
}

psql_supabase() {
  psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 "$@"
}

echo "[sync] ensure local targets + staging schema" >&2
psql_local <<SQL
CREATE SCHEMA IF NOT EXISTS ${STAGING_SCHEMA};
DO \$\$
BEGIN
  IF to_regclass('tile_source.sync_state') IS NULL THEN
    RAISE EXCEPTION 'tile_source.sync_state missing — apply local migration 023 first';
  END IF;
END \$\$;
SQL

declare -a SUMMARY_LINES=()
SYNC_FAILED=0

sync_one() {
  local dataset="$1"
  local table="$2"
  local extract_file="$3"
  local min_rows="$4"
  local extract_path="${SQL_DIR}/${extract_file}"
  local staging_q="${STAGING_SCHEMA}.${table}"
  local target_q="tile_source.${table}"
  local extract_sql
  local staging_count
  local prev_count
  local active_count
  local deleted_count

  if [[ ! -f "$extract_path" ]]; then
    echo "error: missing extract SQL: ${extract_path}" >&2
    return 1
  fi

  echo "" >&2
  echo "[sync] dataset=${dataset}" >&2

  if ! psql_local -tAc "SELECT to_regclass('${target_q}') IS NOT NULL" | grep -qx t; then
    echo "error: missing local table ${target_q} — apply migration 023 (+025 core tombstones, +026 suppressions)" >&2
    return 1
  fi

  prev_count="$(psql_local -tAc "SELECT count(*)::bigint FROM ${target_q}")"

  echo "[sync]   prepare staging ${staging_q}" >&2
  psql_local <<SQL
DROP TABLE IF EXISTS ${staging_q};
CREATE TABLE ${staging_q} (LIKE ${target_q} INCLUDING DEFAULTS INCLUDING GENERATED);
SQL

  extract_sql="$(python3 -c 'import pathlib,sys; print(" ".join(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").split()))' "$extract_path")"
  echo "[sync]   fetch Supabase → staging (live snapshot untouched)" >&2
  tmp_csv="$(mktemp "${TMPDIR:-/tmp}/tile-sync-${dataset}.XXXXXX.csv")"
  cleanup_tmp() { rm -f "$tmp_csv"; }
  trap cleanup_tmp RETURN

  if ! psql_supabase -v ON_ERROR_STOP=1 \
      -c "\copy (${extract_sql}) TO STDOUT WITH (FORMAT csv, NULL '')" \
      >"$tmp_csv"; then
    echo "error: fetch failed for ${dataset}; local ${target_q} unchanged (prev_count=${prev_count})" >&2
    psql_local -c "DROP TABLE IF EXISTS ${staging_q};" >/dev/null 2>&1 || true
    return 1
  fi

  if ! psql_local -v ON_ERROR_STOP=1 \
      -c "\copy ${staging_q} FROM STDIN WITH (FORMAT csv, NULL '')" \
      <"$tmp_csv"; then
    echo "error: staging load failed for ${dataset}; local ${target_q} unchanged (prev_count=${prev_count})" >&2
    psql_local -c "DROP TABLE IF EXISTS ${staging_q};" >/dev/null 2>&1 || true
    return 1
  fi
  rm -f "$tmp_csv"
  trap - RETURN
  staging_count="$(psql_local -tAc "SELECT count(*)::bigint FROM ${staging_q}")"
  echo "[sync]   staging rows=${staging_count} (previous local=${prev_count})" >&2

  if [[ "$staging_count" -lt "$min_rows" ]]; then
    echo "error: staging validation failed for ${dataset}: row_count ${staging_count} < min ${min_rows}; local unchanged" >&2
    psql_local -c "DROP TABLE IF EXISTS ${staging_q};" >/dev/null 2>&1 || true
    return 1
  fi

  # Dataset-specific light validation
  case "$dataset" in
    buildings_core|land_areas_core)
      psql_local -tAc "
        SELECT CASE
          WHEN count(*) FILTER (WHERE feature_key IS NULL OR btrim(feature_key) = '') > 0 THEN 'bad_feature_key'
          WHEN count(*) FILTER (WHERE deleted_at IS NULL AND geom IS NULL) > 0 THEN 'active_null_geom'
          WHEN count(*) <> count(DISTINCT feature_key) THEN 'dup_feature_key'
          ELSE 'ok'
        END
        FROM ${staging_q};
      " | grep -qx ok || {
        echo "error: staging validation failed for ${dataset}; local unchanged" >&2
        psql_local -c "DROP TABLE IF EXISTS ${staging_q};" >/dev/null 2>&1 || true
        return 1
      }
      ;;
    buildings_suppressed|land_areas_suppressed)
      psql_local -tAc "
        SELECT CASE
          WHEN count(*) FILTER (WHERE feature_key IS NULL OR btrim(feature_key) = '') > 0 THEN 'bad_feature_key'
          WHEN count(*) <> count(DISTINCT feature_key) THEN 'dup_feature_key'
          ELSE 'ok'
        END
        FROM ${staging_q};
      " | grep -qx ok || {
        echo "error: staging validation failed for ${dataset}; local unchanged" >&2
        psql_local -c "DROP TABLE IF EXISTS ${staging_q};" >/dev/null 2>&1 || true
        return 1
      }
      ;;
    streets|settlements|admin_areas|admin_labels|water_lines|water_polygons|coastlines|protected_areas)
      psql_local -tAc "
        SELECT CASE
          WHEN count(*) FILTER (WHERE geom IS NULL OR ST_IsEmpty(geom)) > 0 THEN 'bad_geom'
          WHEN count(*) <> count(DISTINCT core_id) THEN 'dup_core_id'
          ELSE 'ok'
        END
        FROM ${staging_q};
      " | grep -qx ok || {
        echo "error: staging validation failed for ${dataset}; local unchanged" >&2
        psql_local -c "DROP TABLE IF EXISTS ${staging_q};" >/dev/null 2>&1 || true
        return 1
      }
      ;;
  esac

  echo "[sync]   transactional replace ${target_q}" >&2
  if ! psql_local <<SQL
BEGIN;
DELETE FROM ${target_q};
INSERT INTO ${target_q} SELECT * FROM ${staging_q};
INSERT INTO tile_source.sync_state AS s (dataset, last_synced_at, source, row_count, updated_at, notes)
VALUES (
  '${dataset}',
  now(),
  'supabase',
  ${staging_count},
  now(),
  'synced by sync-supabase.sh'
)
ON CONFLICT (dataset) DO UPDATE
SET
  last_synced_at = EXCLUDED.last_synced_at,
  source = EXCLUDED.source,
  row_count = EXCLUDED.row_count,
  updated_at = EXCLUDED.updated_at,
  notes = EXCLUDED.notes;
COMMIT;
SQL
  then
    echo "error: replace transaction failed for ${dataset}; local snapshot rolled back to previous good state" >&2
    psql_local -c "DROP TABLE IF EXISTS ${staging_q};" >/dev/null 2>&1 || true
    return 1
  fi

  psql_local -c "DROP TABLE IF EXISTS ${staging_q};" >/dev/null

  active_count=0
  deleted_count=0
  if [[ "$dataset" == "buildings_core" || "$dataset" == "land_areas_core" ]]; then
    active_count="$(psql_local -tAc "SELECT count(*) FILTER (WHERE deleted_at IS NULL)::bigint FROM ${target_q}")"
    deleted_count="$(psql_local -tAc "SELECT count(*) FILTER (WHERE deleted_at IS NOT NULL)::bigint FROM ${target_q}")"
    SUMMARY_LINES+=("${dataset}: total=${staging_count} active=${active_count} deleted=${deleted_count} (was ${prev_count})")
  else
    SUMMARY_LINES+=("${dataset}: total=${staging_count} (was ${prev_count})")
  fi

  echo "[sync]   OK ${dataset} rows=${staging_count}" >&2
  return 0
}

for entry in "${SELECTED[@]}"; do
  IFS='|' read -r ds table extract min_rows <<<"$entry"
  if ! sync_one "$ds" "$table" "$extract" "$min_rows"; then
    SYNC_FAILED=1
    SUMMARY_LINES+=("${ds}: FAILED (previous local snapshot kept)")
  fi
done

echo "" >&2
echo "======== sync summary ========" >&2
for line in "${SUMMARY_LINES[@]}"; do
  echo "  ${line}" >&2
done
echo "==============================" >&2

if [[ "$SYNC_FAILED" -ne 0 ]]; then
  echo "[sync] completed with failures" >&2
  exit 1
fi

echo "[sync] SUCCESS" >&2
echo "" >&2
echo "Local tile_source counts:" >&2
psql_local -c "
SELECT dataset, row_count, last_synced_at, source
FROM tile_source.sync_state
WHERE dataset IN (
  'buildings_core','land_areas_core','buildings_suppressed','land_areas_suppressed','streets','settlements',
  'admin_areas','admin_labels','water_lines','water_polygons',
  'coastlines','protected_areas'
)
ORDER BY dataset;
"
