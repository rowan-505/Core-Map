#!/usr/bin/env bash
# Apply local migration 022 on coremap_tiles with before/after validation.
# Does not delete rows. Does not touch Supabase.
#
# Required:
#   COREMAP_TILES_DATABASE_URL  (preferred)
#   or DATABASE_URL pointing at local coremap_tiles
#
# Usage:
#   COREMAP_TILES_DATABASE_URL='postgresql://USER@localhost:5432/coremap_tiles' \
#     bash infrastructure/database/migrations/local/022_run_tile_source_bulk_migration.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
DB_URL="${COREMAP_TILES_DATABASE_URL:-${DATABASE_URL:-}}"

if [[ -z "$DB_URL" ]]; then
  echo "error: set COREMAP_TILES_DATABASE_URL (or DATABASE_URL) to local coremap_tiles" >&2
  exit 1
fi

if [[ "$DB_URL" == *supabase* || "$DB_URL" == *pooler.supabase* ]]; then
  echo "error: refusing Supabase URL — this migration is local coremap_tiles only" >&2
  exit 1
fi

if [[ "$DB_URL" != *coremap_tiles* ]]; then
  echo "error: database name must be coremap_tiles (got URL without that name)" >&2
  exit 1
fi

command -v psql >/dev/null 2>&1 || { echo "error: psql required" >&2; exit 1; }

echo "[022] BEFORE validation"
psql "$DB_URL" -v ON_ERROR_STOP=1 \
  -c "SELECT set_config('tile_bulk.validate_phase','before',false);" \
  -f "${SCRIPT_DIR}/022_tile_source_bulk_validate.sql"

echo "[022] APPLY migration"
psql "$DB_URL" -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/022_tile_source_buildings_land_areas_base.sql"

echo "[022] AFTER validation"
psql "$DB_URL" -v ON_ERROR_STOP=1 \
  -c "SELECT set_config('tile_bulk.validate_phase','after',false);" \
  -f "${SCRIPT_DIR}/022_tile_source_bulk_validate.sql"

echo "[022] DONE — compare before/after row counts and sizes above. Stop here."
