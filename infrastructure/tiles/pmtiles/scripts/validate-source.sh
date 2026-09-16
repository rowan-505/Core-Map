#!/usr/bin/env bash
# Pre-build validation of local tile_source (and region boundary) data.
# Read-only. Does not repair data or change schema.
#
# Required:
#   LOCAL_TILE_DATABASE_URL  (local coremap_tiles)
#
# Usage:
#   LOCAL_TILE_DATABASE_URL=... bash infrastructure/tiles/pmtiles/scripts/validate-source.sh
#   npm run tiles:validate-source
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-root-env.sh"

if [[ -z "${LOCAL_TILE_DATABASE_URL:-}" ]]; then
  echo "FAIL: LOCAL_TILE_DATABASE_URL is not set." >&2
  echo "  Set it to the local coremap_tiles database, e.g.:" >&2
  echo "  export LOCAL_TILE_DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/coremap_tiles'" >&2
  exit 1
fi

if [[ "${LOCAL_TILE_DATABASE_URL}" == *supabase* || "${LOCAL_TILE_DATABASE_URL}" == *pooler.supabase* ]]; then
  echo "FAIL: LOCAL_TILE_DATABASE_URL must be the local tile DB, not Supabase." >&2
  exit 1
fi

command -v psql >/dev/null 2>&1 || {
  echo "FAIL: psql is required." >&2
  exit 1
}
command -v python3 >/dev/null 2>&1 || {
  echo "FAIL: python3 is required." >&2
  exit 1
}

# Strip Prisma-only query params if present.
LOCAL_TILE_DATABASE_URL="$(
  python3 - "$LOCAL_TILE_DATABASE_URL" <<'PY'
import sys
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse
u = urlparse(sys.argv[1])
drop = {"pgbouncer", "connection_limit", "pool_timeout", "schema"}
qs = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if k.lower() not in drop]
print(urlunparse((u.scheme, u.netloc, u.path, u.params, urlencode(qs), u.fragment)))
PY
)"

python3 - "$LOCAL_TILE_DATABASE_URL" <<'PY'
import re, sys
url = sys.argv[1]
m = re.search(r"@([^@/?]+)(/|\?|$)", url)
print(f"[validate-source] local host: {m.group(1) if m else '(unparsed)'}", file=sys.stderr)
PY

echo "[validate-source] checking important tile_source invariants..." >&2

psql "$LOCAL_TILE_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
\pset pager off
\set ON_ERROR_STOP on

DO $$
DECLARE
  failures text[] := ARRAY[]::text[];
  n bigint;
  n2 bigint;
  ok boolean;
  viewdef text;
BEGIN
  -- Helper pattern: push actionable failure messages.

  -- buildings_base exists and non-empty
  IF to_regclass('tile_source.buildings_base') IS NULL THEN
    failures := array_append(failures,
      'tile_source.buildings_base missing — apply local migration 022 (move basemap_source.buildings)');
  ELSE
    EXECUTE 'SELECT count(*)::bigint FROM tile_source.buildings_base' INTO n;
    IF n = 0 THEN
      failures := array_append(failures,
        'tile_source.buildings_base is empty — restore/load permanent bulk buildings before build');
    END IF;
  END IF;

  -- land_areas_base exists and non-empty
  IF to_regclass('tile_source.land_areas_base') IS NULL THEN
    failures := array_append(failures,
      'tile_source.land_areas_base missing — apply local migration 022 (move basemap_source.land_areas)');
  ELSE
    EXECUTE 'SELECT count(*)::bigint FROM tile_source.land_areas_base' INTO n;
    IF n = 0 THEN
      failures := array_append(failures,
        'tile_source.land_areas_base is empty — restore/load permanent bulk land_areas before build');
    END IF;
  END IF;

  -- buildings_core / land_areas_core tables exist (may be empty before first sync)
  IF to_regclass('tile_source.buildings_core') IS NULL THEN
    failures := array_append(failures,
      'tile_source.buildings_core missing — apply local migration 023');
  END IF;
  IF to_regclass('tile_source.land_areas_core') IS NULL THEN
    failures := array_append(failures,
      'tile_source.land_areas_core missing — apply local migration 023');
  END IF;

  -- streets non-empty
  IF to_regclass('tile_source.streets') IS NULL THEN
    failures := array_append(failures,
      'tile_source.streets missing — apply migration 023 then run tiles:sync');
  ELSE
    EXECUTE 'SELECT count(*)::bigint FROM tile_source.streets' INTO n;
    IF n = 0 THEN
      failures := array_append(failures,
        'tile_source.streets is empty — run: LOCAL_TILE_DATABASE_URL=... SUPABASE_DATABASE_URL=... npm run tiles:sync -- streets');
    END IF;
  END IF;

  -- settlements non-empty
  IF to_regclass('tile_source.settlements') IS NULL THEN
    failures := array_append(failures,
      'tile_source.settlements missing — apply migration 023 then run tiles:sync');
  ELSE
    EXECUTE 'SELECT count(*)::bigint FROM tile_source.settlements' INTO n;
    IF n = 0 THEN
      failures := array_append(failures,
        'tile_source.settlements is empty — run tiles:sync for settlements');
    END IF;
  END IF;

  -- admin_areas non-empty
  IF to_regclass('tile_source.admin_areas') IS NULL THEN
    failures := array_append(failures,
      'tile_source.admin_areas missing — apply migration 023 then run tiles:sync');
  ELSE
    EXECUTE 'SELECT count(*)::bigint FROM tile_source.admin_areas' INTO n;
    IF n = 0 THEN
      failures := array_append(failures,
        'tile_source.admin_areas is empty — run tiles:sync for admin_areas');
    END IF;
  END IF;

  -- water datasets exist (tables present; allow empty coastline historically, but lines/polygons should exist as tables)
  IF to_regclass('tile_source.water_lines') IS NULL THEN
    failures := array_append(failures,
      'tile_source.water_lines missing — apply migration 023 then run tiles:sync');
  END IF;
  IF to_regclass('tile_source.water_polygons') IS NULL THEN
    failures := array_append(failures,
      'tile_source.water_polygons missing — apply migration 023 then run tiles:sync');
  END IF;
  IF to_regclass('tile_source.coastlines') IS NULL THEN
    failures := array_append(failures,
      'tile_source.coastlines missing — apply migration 023 then run tiles:sync');
  END IF;

  -- resolved views: exist, DISTINCT ON contract, no duplicate feature_key, no empty geom
  IF to_regclass('tile_source.buildings_v') IS NULL THEN
    failures := array_append(failures,
      'tile_source.buildings_v missing — apply local migration 024');
  ELSE
    viewdef := pg_get_viewdef('tile_source.buildings_v'::regclass, true);
    IF viewdef IS NULL OR viewdef !~* 'DISTINCT[[:space:]]+ON[[:space:]]*\([[:space:]]*feature_key[[:space:]]*\)' THEN
      failures := array_append(failures,
        'tile_source.buildings_v must DISTINCT ON (feature_key) — re-apply migration 024');
    END IF;

    EXECUTE $q$
      SELECT count(*)::bigint
      FROM (
        SELECT feature_key
        FROM tile_source.buildings_v
        GROUP BY feature_key
        HAVING count(*) > 1
        LIMIT 1
      ) d
    $q$ INTO n;
    IF n > 0 THEN
      failures := array_append(failures,
        'tile_source.buildings_v has duplicate feature_key — inspect Core/Archive/Base resolution');
    END IF;

    EXECUTE $q$
      SELECT count(*)::bigint
      FROM (
        SELECT 1
        FROM tile_source.buildings_v
        WHERE geom IS NULL OR ST_IsEmpty(geom)
        LIMIT 1
      ) d
    $q$ INTO n;
    IF n > 0 THEN
      failures := array_append(failures,
        'tile_source.buildings_v has null/empty geometry — fix source rows or resolved view filters');
    END IF;
  END IF;

  IF to_regclass('tile_source.land_areas_v') IS NULL THEN
    failures := array_append(failures,
      'tile_source.land_areas_v missing — apply local migration 024');
  ELSE
    viewdef := pg_get_viewdef('tile_source.land_areas_v'::regclass, true);
    IF viewdef IS NULL OR viewdef !~* 'DISTINCT[[:space:]]+ON[[:space:]]*\([[:space:]]*feature_key[[:space:]]*\)' THEN
      failures := array_append(failures,
        'tile_source.land_areas_v must DISTINCT ON (feature_key) — re-apply migration 024');
    END IF;

    EXECUTE $q$
      SELECT count(*)::bigint
      FROM (
        SELECT feature_key
        FROM tile_source.land_areas_v
        GROUP BY feature_key
        HAVING count(*) > 1
        LIMIT 1
      ) d
    $q$ INTO n;
    IF n > 0 THEN
      failures := array_append(failures,
        'tile_source.land_areas_v has duplicate feature_key — inspect Core/Archive/Base resolution');
    END IF;

    EXECUTE $q$
      SELECT count(*)::bigint
      FROM (
        SELECT 1
        FROM tile_source.land_areas_v
        WHERE geom IS NULL OR ST_IsEmpty(geom)
        LIMIT 1
      ) d
    $q$ INTO n;
    IF n > 0 THEN
      failures := array_append(failures,
        'tile_source.land_areas_v has null/empty geometry — fix source rows or resolved view filters');
    END IF;
  END IF;

  -- successful sync_state for required synced snapshots
  IF to_regclass('tile_source.sync_state') IS NULL THEN
    failures := array_append(failures,
      'tile_source.sync_state missing — apply migration 023 then run tiles:sync');
  ELSE
    EXECUTE $q$
      SELECT count(*)::bigint
      FROM tile_source.sync_state
      WHERE dataset IN ('streets', 'settlements', 'admin_areas', 'water_lines', 'water_polygons')
        AND last_synced_at IS NOT NULL
        AND coalesce(row_count, 0) > 0
    $q$ INTO n;
    IF n < 5 THEN
      failures := array_append(failures,
        format(
          'tile_source.sync_state incomplete (%s/5 required datasets with last_synced_at + row_count>0 for streets/settlements/admin_areas/water_lines/water_polygons) — run tiles:sync',
          n
        ));
    END IF;

    -- buildings_core / land_areas_core should at least have a sync attempt recorded
    EXECUTE $q$
      SELECT count(*)::bigint
      FROM tile_source.sync_state
      WHERE dataset IN ('buildings_core', 'land_areas_core')
        AND last_synced_at IS NOT NULL
    $q$ INTO n;
    IF n < 2 THEN
      failures := array_append(failures,
        'tile_source.sync_state missing successful sync for buildings_core and/or land_areas_core — run tiles:sync');
    END IF;
  END IF;

  -- package boundary data (local admin snapshot for regional export clipping)
  IF to_regclass('tile_source.admin_areas') IS NULL THEN
    failures := array_append(failures,
      'tile_source.admin_areas missing — apply migration 023 and run tiles:sync for admin_areas');
  ELSE
    EXECUTE $q$
      SELECT count(*)::bigint
      FROM tile_source.admin_areas AS a
      WHERE a.admin_level_code = 'state_region'
        AND a.is_active IS TRUE
        AND a.deleted_at IS NULL
        AND a.geom IS NOT NULL
        AND NOT ST_IsEmpty(a.geom)
        AND ST_IsValid(a.geom)
    $q$ INTO n;
    IF n < 15 THEN
      failures := array_append(failures,
        format(
          'package boundary data insufficient: found %s valid state_region polygons in tile_source.admin_areas (need >= 15) — run tiles:sync for admin_areas',
          n
        ));
    END IF;
  END IF;

  IF cardinality(failures) > 0 THEN
    RAISE NOTICE 'VALIDATE-SOURCE FAIL (%s checks)', cardinality(failures);
    FOR n IN 1 .. cardinality(failures) LOOP
      RAISE NOTICE '  - %', failures[n];
    END LOOP;
    RAISE EXCEPTION 'validate-source FAILED with % error(s) — fix items above before tiles:build', cardinality(failures);
  END IF;

  RAISE NOTICE 'VALIDATE-SOURCE PASS';
END $$;
SQL

echo "PASS" >&2
