-- =============================================================================
-- Local-only validation: tile_source expected tables exist
-- Target DB: coremap_tiles. Read-only aside from temp check output.
--
--   psql "$COREMAP_TILES_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f infrastructure/database/migrations/local/023_tile_source_tables_validate.sql
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

\echo '=== tile_source expected tables ==='
WITH expected(table_name, role) AS (
  VALUES
    ('buildings_base', 'permanent_bulk'),
    ('land_areas_base', 'permanent_bulk'),
    ('buildings_core', 'supabase_cache'),
    ('land_areas_core', 'supabase_cache'),
    ('buildings_archive', 'demotion_archive'),
    ('land_areas_archive', 'demotion_archive'),
    ('streets', 'supabase_snapshot'),
    ('settlements', 'supabase_snapshot'),
    ('admin_areas', 'supabase_snapshot'),
    ('admin_labels', 'supabase_snapshot'),
    ('water_lines', 'supabase_snapshot'),
    ('water_polygons', 'supabase_snapshot'),
    ('coastlines', 'supabase_snapshot'),
    ('protected_areas', 'supabase_snapshot'),
    ('sync_state', 'metadata')
)
SELECT
  e.table_name,
  e.role,
  (to_regclass(format('tile_source.%I', e.table_name)) IS NOT NULL) AS exists
FROM expected e
ORDER BY e.table_name;

\echo '=== missing tables (must be empty) ==='
WITH expected(table_name) AS (
  VALUES
    ('buildings_base'),
    ('land_areas_base'),
    ('buildings_core'),
    ('land_areas_core'),
    ('buildings_archive'),
    ('land_areas_archive'),
    ('streets'),
    ('settlements'),
    ('admin_areas'),
    ('admin_labels'),
    ('water_lines'),
    ('water_polygons'),
    ('coastlines'),
    ('protected_areas'),
    ('sync_state')
)
SELECT e.table_name
FROM expected e
WHERE to_regclass(format('tile_source.%I', e.table_name)) IS NULL
ORDER BY 1;

DO $$
DECLARE
  missing text[];
BEGIN
  SELECT array_agg(table_name ORDER BY table_name)
  INTO missing
  FROM (
    VALUES
      ('buildings_base'),
      ('land_areas_base'),
      ('buildings_core'),
      ('land_areas_core'),
      ('buildings_archive'),
      ('land_areas_archive'),
      ('streets'),
      ('settlements'),
      ('admin_areas'),
      ('admin_labels'),
      ('water_lines'),
      ('water_polygons'),
      ('coastlines'),
      ('protected_areas'),
      ('sync_state')
  ) AS e(table_name)
  WHERE to_regclass(format('tile_source.%I', e.table_name)) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '023 validate failed — missing tile_source tables: %', missing;
  END IF;

  RAISE NOTICE '023 validate OK — all 15 expected tile_source tables exist';
END $$;

\echo '=== key columns on *_core / archive / sync_state ==='
SELECT
  c.relname AS table_name,
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'tile_source'
  AND c.relname IN (
    'buildings_core', 'land_areas_core',
    'buildings_archive', 'land_areas_archive',
    'sync_state'
  )
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND a.attname IN (
    'feature_key', 'core_id', 'core_public_id', 'geom',
    'class_code', 'is_active', 'deleted_at', 'core_snapshot',
    'demoted_at', 'dataset', 'last_synced_at'
  )
ORDER BY 1, a.attnum;

\echo '=== sync_state seed keys ==='
SELECT dataset, last_synced_at, notes
FROM tile_source.sync_state
ORDER BY dataset;
