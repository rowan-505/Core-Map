#!/usr/bin/env bash
# Apply 024 resolved views and run A–F validation (rolled back).
# Local coremap_tiles only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
DB_URL="${COREMAP_TILES_DATABASE_URL:-${DATABASE_URL:-}}"

if [[ -z "$DB_URL" ]]; then
  echo "error: set COREMAP_TILES_DATABASE_URL to local coremap_tiles" >&2
  exit 1
fi
if [[ "$DB_URL" == *supabase* || "$DB_URL" == *pooler.supabase* ]]; then
  echo "error: refusing Supabase URL" >&2
  exit 1
fi
if [[ "$DB_URL" != *coremap_tiles* ]]; then
  echo "error: database name must be coremap_tiles" >&2
  exit 1
fi

echo "[024] apply views"
psql "$DB_URL" -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/024_tile_source_resolved_views.sql"

echo "[024] validate A–F"
psql "$DB_URL" -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/024_tile_source_resolved_views_validate.sql"

echo "[024] DONE"
