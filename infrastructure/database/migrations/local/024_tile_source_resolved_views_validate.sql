-- =============================================================================
-- Local-only validation: tile_source.buildings_v / land_areas_v resolution
--
-- Inserts synthetic rows, asserts cases A–F, then ROLLBACKs (no lasting data).
-- Requires migrations 022–024 applied.
--
--   psql "$COREMAP_TILES_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f infrastructure/database/migrations/local/024_tile_source_resolved_views_validate.sql
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

\echo '=== precondition: views exist ==='
SELECT
  to_regclass('tile_source.buildings_v') AS buildings_v,
  to_regclass('tile_source.land_areas_v') AS land_areas_v;

DO $$
BEGIN
  IF to_regclass('tile_source.buildings_v') IS NULL
     OR to_regclass('tile_source.land_areas_v') IS NULL THEN
    RAISE EXCEPTION '024 validate: resolved views missing — apply 024_tile_source_resolved_views.sql first';
  END IF;
  IF to_regclass('tile_source.buildings_base') IS NULL
     OR to_regclass('tile_source.buildings_core') IS NULL
     OR to_regclass('tile_source.buildings_archive') IS NULL THEN
    RAISE EXCEPTION '024 validate: buildings base/core/archive missing — apply 022 and 023 first';
  END IF;
  IF to_regclass('tile_source.land_areas_base') IS NULL
     OR to_regclass('tile_source.land_areas_core') IS NULL
     OR to_regclass('tile_source.land_areas_archive') IS NULL THEN
    RAISE EXCEPTION '024 validate: land_areas base/core/archive missing — apply 022 and 023 first';
  END IF;
END $$;

BEGIN;

-- Tiny valid multipolygon (SRID 4326)
CREATE TEMP TABLE _g ON COMMIT DROP AS
SELECT
  ST_SetSRID(
    ST_GeomFromText(
      'MULTIPOLYGON(((96.0 16.0, 96.0 16.001, 96.001 16.001, 96.001 16.0, 96.0 16.0)))'
    ),
    4326
  )::geometry(MultiPolygon, 4326) AS geom;

-- Synthetic OSM ids in a high range unlikely to collide with real Myanmar OSM data.
-- Cases share prefixes: A..F for buildings (910000000x) and land (920000000x).

\echo '=== seed buildings cases A–E ==='
-- A: base only
INSERT INTO tile_source.buildings_base (
  external_id, osm_feature_type, osm_id, source_snapshot_id,
  class_code, canonical_name, normalized_data, source_refs, geom
)
SELECT
  'osm:way:9100000001', 'way', 9100000001, 1,
  'yes', 'CASE_A_BASE', '{}'::jsonb, '{}'::jsonb, g.geom
FROM _g g;

-- B: base + active core
INSERT INTO tile_source.buildings_base (
  external_id, osm_feature_type, osm_id, source_snapshot_id,
  class_code, canonical_name, normalized_data, source_refs, geom
)
SELECT
  'osm:way:9100000002', 'way', 9100000002, 1,
  'yes', 'CASE_B_BASE', '{}'::jsonb, '{}'::jsonb, g.geom
FROM _g g;

INSERT INTO tile_source.buildings_core (
  feature_key, core_id, class_code, name, geom, is_active, deleted_at
)
SELECT
  'osm:way:9100000002', 9100000002, 'residential', 'CASE_B_CORE', g.geom, true, NULL
FROM _g g;

-- C: base + archive, no core
INSERT INTO tile_source.buildings_base (
  external_id, osm_feature_type, osm_id, source_snapshot_id,
  class_code, canonical_name, normalized_data, source_refs, geom
)
SELECT
  'osm:way:9100000003', 'way', 9100000003, 1,
  'yes', 'CASE_C_BASE', '{}'::jsonb, '{}'::jsonb, g.geom
FROM _g g;

INSERT INTO tile_source.buildings_archive (
  feature_key, core_id, class_code, name, geom, demotion_reason
)
SELECT
  'osm:way:9100000003', 9100000003, 'commercial', 'CASE_C_ARCHIVE', g.geom, 'demoted_test'
FROM _g g;

-- D: base + archive + active core
INSERT INTO tile_source.buildings_base (
  external_id, osm_feature_type, osm_id, source_snapshot_id,
  class_code, canonical_name, normalized_data, source_refs, geom
)
SELECT
  'osm:way:9100000004', 'way', 9100000004, 1,
  'yes', 'CASE_D_BASE', '{}'::jsonb, '{}'::jsonb, g.geom
FROM _g g;

INSERT INTO tile_source.buildings_archive (
  feature_key, core_id, class_code, name, geom, demotion_reason
)
SELECT
  'osm:way:9100000004', 9100000004, 'commercial', 'CASE_D_ARCHIVE', g.geom, 'demoted_test'
FROM _g g;

INSERT INTO tile_source.buildings_core (
  feature_key, core_id, class_code, name, geom, is_active, deleted_at
)
SELECT
  'osm:way:9100000004', 9100000004, 'apartments', 'CASE_D_CORE', g.geom, true, NULL
FROM _g g;

-- E: base + archive + tombstoned core => nothing renders
INSERT INTO tile_source.buildings_base (
  external_id, osm_feature_type, osm_id, source_snapshot_id,
  class_code, canonical_name, normalized_data, source_refs, geom
)
SELECT
  'osm:way:9100000005', 'way', 9100000005, 1,
  'yes', 'CASE_E_BASE', '{}'::jsonb, '{}'::jsonb, g.geom
FROM _g g;

INSERT INTO tile_source.buildings_archive (
  feature_key, core_id, class_code, name, geom, demotion_reason
)
SELECT
  'osm:way:9100000005', 9100000005, 'commercial', 'CASE_E_ARCHIVE', g.geom, 'demoted_test'
FROM _g g;

INSERT INTO tile_source.buildings_core (
  feature_key, core_id, class_code, name, geom, is_active, deleted_at
)
SELECT
  'osm:way:9100000005', 9100000005, 'yes', 'CASE_E_TOMBSTONE', g.geom, false, now()
FROM _g g;

\echo '=== seed land_areas cases A–E ==='
INSERT INTO tile_source.land_areas_base (
  external_id, osm_feature_type, osm_id, source_snapshot_id,
  class_code, canonical_name, import_class, normalized_data, source_refs, geom
)
SELECT
  'osm:way:9200000001', 'way', 9200000001, 1,
  'residential', 'LAND_A_BASE', 'pmtiles_only', '{}'::jsonb, '{}'::jsonb, g.geom
FROM _g g;

INSERT INTO tile_source.land_areas_base (
  external_id, osm_feature_type, osm_id, source_snapshot_id,
  class_code, canonical_name, import_class, normalized_data, source_refs, geom
)
SELECT
  'osm:way:9200000002', 'way', 9200000002, 1,
  'residential', 'LAND_B_BASE', 'pmtiles_only', '{}'::jsonb, '{}'::jsonb, g.geom
FROM _g g;

INSERT INTO tile_source.land_areas_core (
  feature_key, core_id, class_code, name, geom, is_active, deleted_at
)
SELECT
  'osm:way:9200000002', 9200000002, 'industrial', 'LAND_B_CORE', g.geom, true, NULL
FROM _g g;

INSERT INTO tile_source.land_areas_base (
  external_id, osm_feature_type, osm_id, source_snapshot_id,
  class_code, canonical_name, import_class, normalized_data, source_refs, geom
)
SELECT
  'osm:way:9200000003', 'way', 9200000003, 1,
  'residential', 'LAND_C_BASE', 'pmtiles_only', '{}'::jsonb, '{}'::jsonb, g.geom
FROM _g g;

INSERT INTO tile_source.land_areas_archive (
  feature_key, core_id, class_code, name, geom, demotion_reason
)
SELECT
  'osm:way:9200000003', 9200000003, 'forest', 'LAND_C_ARCHIVE', g.geom, 'demoted_test'
FROM _g g;

INSERT INTO tile_source.land_areas_base (
  external_id, osm_feature_type, osm_id, source_snapshot_id,
  class_code, canonical_name, import_class, normalized_data, source_refs, geom
)
SELECT
  'osm:way:9200000004', 'way', 9200000004, 1,
  'residential', 'LAND_D_BASE', 'pmtiles_only', '{}'::jsonb, '{}'::jsonb, g.geom
FROM _g g;

INSERT INTO tile_source.land_areas_archive (
  feature_key, core_id, class_code, name, geom, demotion_reason
)
SELECT
  'osm:way:9200000004', 9200000004, 'forest', 'LAND_D_ARCHIVE', g.geom, 'demoted_test'
FROM _g g;

INSERT INTO tile_source.land_areas_core (
  feature_key, core_id, class_code, name, geom, is_active, deleted_at
)
SELECT
  'osm:way:9200000004', 9200000004, 'retail', 'LAND_D_CORE', g.geom, true, NULL
FROM _g g;

INSERT INTO tile_source.land_areas_base (
  external_id, osm_feature_type, osm_id, source_snapshot_id,
  class_code, canonical_name, import_class, normalized_data, source_refs, geom
)
SELECT
  'osm:way:9200000005', 'way', 9200000005, 1,
  'residential', 'LAND_E_BASE', 'pmtiles_only', '{}'::jsonb, '{}'::jsonb, g.geom
FROM _g g;

INSERT INTO tile_source.land_areas_archive (
  feature_key, core_id, class_code, name, geom, demotion_reason
)
SELECT
  'osm:way:9200000005', 9200000005, 'forest', 'LAND_E_ARCHIVE', g.geom, 'demoted_test'
FROM _g g;

INSERT INTO tile_source.land_areas_core (
  feature_key, core_id, class_code, name, geom, is_active, deleted_at
)
SELECT
  'osm:way:9200000005', 9200000005, 'residential', 'LAND_E_TOMBSTONE', g.geom, false, now()
FROM _g g;

\echo '=== assert buildings A–E ==='
DO $$
DECLARE
  src text;
  nm text;
  n bigint;
BEGIN
  SELECT source, name INTO src, nm
  FROM tile_source.buildings_v WHERE feature_key = 'osm:way:9100000001';
  IF src IS DISTINCT FROM 'base' OR nm IS DISTINCT FROM 'CASE_A_BASE' THEN
    RAISE EXCEPTION 'A failed: expected base/CASE_A_BASE got % / %', src, nm;
  END IF;

  SELECT source, name INTO src, nm
  FROM tile_source.buildings_v WHERE feature_key = 'osm:way:9100000002';
  IF src IS DISTINCT FROM 'core' OR nm IS DISTINCT FROM 'CASE_B_CORE' THEN
    RAISE EXCEPTION 'B failed: expected core/CASE_B_CORE got % / %', src, nm;
  END IF;

  SELECT source, name INTO src, nm
  FROM tile_source.buildings_v WHERE feature_key = 'osm:way:9100000003';
  IF src IS DISTINCT FROM 'archive' OR nm IS DISTINCT FROM 'CASE_C_ARCHIVE' THEN
    RAISE EXCEPTION 'C failed: expected archive/CASE_C_ARCHIVE got % / %', src, nm;
  END IF;

  SELECT source, name INTO src, nm
  FROM tile_source.buildings_v WHERE feature_key = 'osm:way:9100000004';
  IF src IS DISTINCT FROM 'core' OR nm IS DISTINCT FROM 'CASE_D_CORE' THEN
    RAISE EXCEPTION 'D failed: expected core/CASE_D_CORE got % / %', src, nm;
  END IF;

  SELECT count(*) INTO n
  FROM tile_source.buildings_v WHERE feature_key = 'osm:way:9100000005';
  IF n <> 0 THEN
    RAISE EXCEPTION 'E failed: expected 0 rows for tombstone key, got %', n;
  END IF;

  RAISE NOTICE 'buildings cases A–E OK';
END $$;

\echo '=== assert land_areas A–E ==='
DO $$
DECLARE
  src text;
  nm text;
  n bigint;
BEGIN
  SELECT source, name INTO src, nm
  FROM tile_source.land_areas_v WHERE feature_key = 'osm:way:9200000001';
  IF src IS DISTINCT FROM 'base' OR nm IS DISTINCT FROM 'LAND_A_BASE' THEN
    RAISE EXCEPTION 'land A failed: expected base/LAND_A_BASE got % / %', src, nm;
  END IF;

  SELECT source, name INTO src, nm
  FROM tile_source.land_areas_v WHERE feature_key = 'osm:way:9200000002';
  IF src IS DISTINCT FROM 'core' OR nm IS DISTINCT FROM 'LAND_B_CORE' THEN
    RAISE EXCEPTION 'land B failed: expected core/LAND_B_CORE got % / %', src, nm;
  END IF;

  SELECT source, name INTO src, nm
  FROM tile_source.land_areas_v WHERE feature_key = 'osm:way:9200000003';
  IF src IS DISTINCT FROM 'archive' OR nm IS DISTINCT FROM 'LAND_C_ARCHIVE' THEN
    RAISE EXCEPTION 'land C failed: expected archive/LAND_C_ARCHIVE got % / %', src, nm;
  END IF;

  SELECT source, name INTO src, nm
  FROM tile_source.land_areas_v WHERE feature_key = 'osm:way:9200000004';
  IF src IS DISTINCT FROM 'core' OR nm IS DISTINCT FROM 'LAND_D_CORE' THEN
    RAISE EXCEPTION 'land D failed: expected core/LAND_D_CORE got % / %', src, nm;
  END IF;

  SELECT count(*) INTO n
  FROM tile_source.land_areas_v WHERE feature_key = 'osm:way:9200000005';
  IF n <> 0 THEN
    RAISE EXCEPTION 'land E failed: expected 0 rows for tombstone key, got %', n;
  END IF;

  RAISE NOTICE 'land_areas cases A–E OK';
END $$;

\echo '=== assert F: no duplicate feature_key (synthetic multi-source keys) ==='
DO $$
DECLARE
  total bigint;
  distinct_n bigint;
BEGIN
  -- Cases B/C/D intentionally have multiple source rows for one feature_key.
  -- Resolved view must return exactly one row per key (DISTINCT ON contract).
  SELECT count(*), count(DISTINCT feature_key)
  INTO total, distinct_n
  FROM tile_source.buildings_v
  WHERE feature_key IN (
    'osm:way:9100000001',
    'osm:way:9100000002',
    'osm:way:9100000003',
    'osm:way:9100000004',
    'osm:way:9100000005'
  );
  -- E contributes 0 rows; A–D contribute 4 rows / 4 keys.
  IF total <> 4 OR distinct_n <> 4 THEN
    RAISE EXCEPTION
      'F buildings failed: expected 4 rows / 4 distinct keys, got % / %',
      total, distinct_n;
  END IF;

  SELECT count(*), count(DISTINCT feature_key)
  INTO total, distinct_n
  FROM tile_source.land_areas_v
  WHERE feature_key IN (
    'osm:way:9200000001',
    'osm:way:9200000002',
    'osm:way:9200000003',
    'osm:way:9200000004',
    'osm:way:9200000005'
  );
  IF total <> 4 OR distinct_n <> 4 THEN
    RAISE EXCEPTION
      'F land_areas failed: expected 4 rows / 4 distinct keys, got % / %',
      total, distinct_n;
  END IF;

  RAISE NOTICE 'case F OK — no duplicate feature_key among synthetic keys';
END $$;

\echo '=== case summary (buildings synthetic keys) ==='
SELECT feature_key, source, name
FROM tile_source.buildings_v
WHERE feature_key LIKE 'osm:way:910000000%'
ORDER BY feature_key;

\echo '=== case summary (land_areas synthetic keys) ==='
SELECT feature_key, source, name
FROM tile_source.land_areas_v
WHERE feature_key LIKE 'osm:way:920000000%'
ORDER BY feature_key;

ROLLBACK;

\echo '024 resolved-view validation PASSED (transaction rolled back)'
