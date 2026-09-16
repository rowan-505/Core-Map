#!/usr/bin/env bash
# Apply local migration 023 and validate tile_source table presence.
# Local coremap_tiles only. Refuses Supabase URLs.
#
#   COREMAP_TILES_DATABASE_URL='postgresql://USER@localhost:5432/coremap_tiles' \
#     bash infrastructure/database/migrations/local/023_run_tile_source_cache_archive.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# Prefer LOCAL_TILE_DATABASE_URL; keep COREMAP_TILES_DATABASE_URL as alias.
DB_URL="${LOCAL_TILE_DATABASE_URL:-${COREMAP_TILES_DATABASE_URL:-${DATABASE_URL:-}}}"

if [[ -z "$DB_URL" ]]; then
  echo "error: set LOCAL_TILE_DATABASE_URL (or COREMAP_TILES_DATABASE_URL) to local coremap_tiles" >&2
  exit 1
fi

if [[ "$DB_URL" == *supabase* || "$DB_URL" == *pooler.supabase* ]]; then
  echo "error: refusing Supabase URL — local coremap_tiles only" >&2
  exit 1
fi

if [[ "$DB_URL" != *coremap_tiles* ]]; then
  echo "error: database name must be coremap_tiles" >&2
  exit 1
fi

echo "[023] apply migration"
psql "$DB_URL" -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/023_tile_source_cache_archive_tables.sql"

echo "[023] validate tables"
psql "$DB_URL" -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/023_tile_source_tables_validate.sql"

echo "[023] DONE"
