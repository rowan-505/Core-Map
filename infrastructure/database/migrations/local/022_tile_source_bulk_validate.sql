-- =============================================================================
-- Local-only READ-ONLY validation for permanent bulk tile tables.
-- Target DB: coremap_tiles. Never apply to Supabase.
--
-- Validates whichever of these currently exist:
--   basemap_source.buildings / basemap_source.land_areas
--   tile_source.buildings_base / tile_source.land_areas_base
--
-- Usage:
--   psql "$COREMAP_TILES_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f infrastructure/database/migrations/local/022_tile_source_bulk_validate.sql
-- =============================================================================

\pset pager off
\timing on
\set ON_ERROR_STOP on

CREATE TEMP TABLE IF NOT EXISTS tmp_tile_bulk_health (
  phase text,
  family text,
  relation text,
  row_count bigint,
  null_geom bigint,
  empty_geom bigint,
  invalid_geom bigint,
  invalid_geom_scope text,
  non_4326 bigint,
  osm_pair_null bigint,
  external_id_null_or_blank bigint,
  dup_osm_identity_groups bigint,
  dup_osm_identity_rows bigint,
  dup_external_id_groups bigint,
  external_id_canonical_long bigint,
  external_id_legacy_short bigint,
  external_id_other bigint,
  total_bytes bigint,
  total_size text,
  has_gist_geom boolean,
  has_unique_osm_identity boolean,
  has_unique_external_id boolean
);

TRUNCATE tmp_tile_bulk_health;

DO $$
DECLARE
  v_phase text := COALESCE(current_setting('tile_bulk.validate_phase', true), 'validate');
  rec record;
  rel regclass;
  sql text;
  row_count bigint;
  null_geom bigint;
  empty_geom bigint;
  invalid_geom bigint;
  invalid_geom_scope text;
  non_4326 bigint;
  osm_pair_null bigint;
  external_id_null_or_blank bigint;
  dup_osm_groups bigint;
  dup_osm_rows bigint;
  dup_ext_groups bigint;
  ext_canonical bigint;
  ext_legacy bigint;
  ext_other bigint;
  total_bytes bigint;
  has_gist boolean;
  has_osm_uidx boolean;
  has_ext_uidx boolean;
  has_external_id boolean;
  has_osm_cols boolean;
BEGIN
  FOR rec IN
    SELECT *
    FROM (
      VALUES
        ('buildings', 'basemap_source', 'buildings'),
        ('buildings', 'tile_source', 'buildings_base'),
        ('land_areas', 'basemap_source', 'land_areas'),
        ('land_areas', 'tile_source', 'land_areas_base')
    ) AS t(family, schema_name, table_name)
  LOOP
    rel := to_regclass(format('%I.%I', rec.schema_name, rec.table_name));
    IF rel IS NULL THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = rec.schema_name
        AND table_name = rec.table_name
        AND column_name = 'external_id'
    ) INTO has_external_id;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = rec.schema_name
        AND table_name = rec.table_name
        AND column_name = 'osm_feature_type'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = rec.schema_name
        AND table_name = rec.table_name
        AND column_name = 'osm_id'
    ) INTO has_osm_cols;

    -- Cheap full-table counts first (null/empty/srid). Invalid geom is expensive:
    -- full scan for smaller tables; TABLESAMPLE probe for very large building sets.
    sql := format($q$
      SELECT
        count(*)::bigint,
        count(*) FILTER (WHERE geom IS NULL)::bigint,
        count(*) FILTER (WHERE geom IS NOT NULL AND ST_IsEmpty(geom))::bigint,
        count(*) FILTER (WHERE geom IS NOT NULL AND ST_SRID(geom) <> 4326)::bigint
      FROM %s
    $q$, rel);
    EXECUTE sql INTO row_count, null_geom, empty_geom, non_4326;

    IF row_count > 1000000 THEN
      sql := format($q$
        SELECT count(*) FILTER (
          WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom) AND NOT ST_IsValid(geom)
        )::bigint
        FROM (
          SELECT geom FROM %s TABLESAMPLE SYSTEM (0.2) REPEATABLE (22)
        ) s
      $q$, rel);
      EXECUTE sql INTO invalid_geom;
      invalid_geom_scope := 'sample_system_0.2pct';
    ELSE
      sql := format($q$
        SELECT count(*) FILTER (
          WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom) AND NOT ST_IsValid(geom)
        )::bigint
        FROM %s
      $q$, rel);
      EXECUTE sql INTO invalid_geom;
      invalid_geom_scope := 'full_table';
    END IF;

    IF has_osm_cols THEN
      sql := format($q$
        SELECT count(*) FILTER (
          WHERE osm_feature_type IS NULL OR osm_id IS NULL
        )::bigint
        FROM %s
      $q$, rel);
      EXECUTE sql INTO osm_pair_null;

      sql := format($q$
        SELECT
          count(*)::bigint,
          coalesce(sum(c), 0)::bigint
        FROM (
          SELECT osm_feature_type, osm_id, count(*) AS c
          FROM %s
          WHERE osm_feature_type IS NOT NULL AND osm_id IS NOT NULL
          GROUP BY 1, 2
          HAVING count(*) > 1
        ) d
      $q$, rel);
      EXECUTE sql INTO dup_osm_groups, dup_osm_rows;
    ELSE
      osm_pair_null := NULL;
      dup_osm_groups := NULL;
      dup_osm_rows := NULL;
    END IF;

    IF has_external_id THEN
      sql := format($q$
        SELECT
          count(*) FILTER (WHERE external_id IS NULL OR btrim(external_id) = '')::bigint,
          count(*) FILTER (
            WHERE btrim(external_id) ~ '^osm:(node|way|relation):[0-9]+$'
          )::bigint,
          count(*) FILTER (
            WHERE btrim(external_id) ~ '^osm:[NWR]:[0-9]+$'
          )::bigint,
          count(*) FILTER (
            WHERE external_id IS NOT NULL
              AND btrim(external_id) <> ''
              AND btrim(external_id) !~ '^osm:(node|way|relation):[0-9]+$'
              AND btrim(external_id) !~ '^osm:[NWR]:[0-9]+$'
          )::bigint
        FROM %s
      $q$, rel);
      EXECUTE sql INTO external_id_null_or_blank, ext_canonical, ext_legacy, ext_other;

      sql := format($q$
        SELECT count(*)::bigint
        FROM (
          SELECT external_id
          FROM %s
          WHERE external_id IS NOT NULL AND btrim(external_id) <> ''
          GROUP BY 1
          HAVING count(*) > 1
        ) d
      $q$, rel);
      EXECUTE sql INTO dup_ext_groups;
    ELSE
      external_id_null_or_blank := NULL;
      ext_canonical := NULL;
      ext_legacy := NULL;
      ext_other := NULL;
      dup_ext_groups := NULL;
    END IF;

    total_bytes := pg_total_relation_size(rel);

    SELECT EXISTS (
      SELECT 1
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_am am ON am.oid = ic.relam
      WHERE i.indrelid = rel
        AND am.amname = 'gist'
        AND pg_get_indexdef(i.indexrelid) ILIKE '%(geom)%'
    ) INTO has_gist;

    SELECT EXISTS (
      SELECT 1
      FROM pg_index i
      WHERE i.indrelid = rel
        AND i.indisunique
        AND pg_get_indexdef(i.indexrelid) ILIKE '%osm_feature_type%'
        AND pg_get_indexdef(i.indexrelid) ILIKE '%osm_id%'
    ) INTO has_osm_uidx;

    SELECT EXISTS (
      SELECT 1
      FROM pg_index i
      WHERE i.indrelid = rel
        AND i.indisunique
        AND pg_get_indexdef(i.indexrelid) ILIKE '%(external_id)%'
    ) INTO has_ext_uidx;

    INSERT INTO tmp_tile_bulk_health VALUES (
      v_phase,
      rec.family,
      format('%s.%s', rec.schema_name, rec.table_name),
      row_count,
      null_geom,
      empty_geom,
      invalid_geom,
      invalid_geom_scope,
      non_4326,
      osm_pair_null,
      external_id_null_or_blank,
      dup_osm_groups,
      dup_osm_rows,
      dup_ext_groups,
      ext_canonical,
      ext_legacy,
      ext_other,
      total_bytes,
      pg_size_pretty(total_bytes),
      has_gist,
      has_osm_uidx,
      has_ext_uidx
    );
  END LOOP;
END $$;

\echo '=== relation presence ==='
SELECT
  to_regclass('basemap_source.buildings') AS basemap_buildings,
  to_regclass('basemap_source.land_areas') AS basemap_land_areas,
  to_regclass('tile_source.buildings_base') AS tile_buildings_base,
  to_regclass('tile_source.land_areas_base') AS tile_land_areas_base;

\echo '=== identity / geometry columns ==='
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('basemap_source', 'tile_source')
  AND c.relname IN ('buildings', 'land_areas', 'buildings_base', 'land_areas_base')
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND a.attname IN (
    'id', 'external_id', 'osm_feature_type', 'osm_id', 'feature_key',
    'source_feature_type', 'source_feature_id', 'geom',
    'core_public_id', 'is_managed_in_core'
  )
ORDER BY 1, 2, a.attnum;

\echo '=== indexes ==='
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE (schemaname, tablename) IN (
  ('basemap_source', 'buildings'),
  ('basemap_source', 'land_areas'),
  ('tile_source', 'buildings_base'),
  ('tile_source', 'land_areas_base')
)
ORDER BY 1, 2, 3;

\echo '=== geometry_columns ==='
SELECT f_table_schema, f_table_name, f_geometry_column, type, srid
FROM geometry_columns
WHERE (f_table_schema, f_table_name) IN (
  ('basemap_source', 'buildings'),
  ('basemap_source', 'land_areas'),
  ('tile_source', 'buildings_base'),
  ('tile_source', 'land_areas_base')
)
ORDER BY 1, 2;

\echo '=== health summary ==='
SELECT *
FROM tmp_tile_bulk_health
ORDER BY family, relation;
