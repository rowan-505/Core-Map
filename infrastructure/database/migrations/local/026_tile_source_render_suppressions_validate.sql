-- =============================================================================
-- Local-only validation: DELETE suppression precedence for buildings / land_areas
--
--   psql "$COREMAP_TILES_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f infrastructure/database/migrations/local/026_tile_source_render_suppressions.sql \
--     -f infrastructure/database/migrations/local/026_tile_source_render_suppressions_validate.sql
-- =============================================================================

\pset pager off
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('tile_source.buildings_suppressed') IS NULL
     OR to_regclass('tile_source.land_areas_suppressed') IS NULL THEN
    RAISE EXCEPTION '026 validate: suppression tables missing';
  END IF;
END $$;

BEGIN;

CREATE TEMP TABLE _g ON COMMIT DROP AS
SELECT
  ST_SetSRID(
    ST_GeomFromText(
      'MULTIPOLYGON(((96.0 16.0, 96.0 16.001, 96.001 16.001, 96.001 16.0, 96.0 16.0)))'
    ),
    4326
  )::geometry(MultiPolygon, 4326) AS geom;

-- 1) Base + suppression -> absent
INSERT INTO tile_source.buildings_base (
  external_id, osm_feature_type, osm_id, source_snapshot_id,
  class_code, canonical_name, normalized_data, source_refs, geom
)
SELECT 'osm:way:9100000011', 'way', 9100000011, 1, 'yes', 'DEL_BASE', '{}'::jsonb, '{}'::jsonb, g.geom
FROM _g g;
INSERT INTO tile_source.buildings_suppressed (feature_key, reason)
VALUES ('osm:way:9100000011', 'delete');

INSERT INTO tile_source.land_areas_base (
  external_id, osm_feature_type, osm_id, source_snapshot_id,
  class_code, canonical_name, import_class, normalized_data, source_refs, geom
)
SELECT 'osm:way:9200000011', 'way', 9200000011, 1, 'residential', 'LAND_DEL_BASE', 'residential', '{}'::jsonb, '{}'::jsonb, g.geom
FROM _g g;
INSERT INTO tile_source.land_areas_suppressed (feature_key, reason)
VALUES ('osm:way:9200000011', 'delete');

-- 2) Archive + suppression -> absent
INSERT INTO tile_source.buildings_archive (
  feature_key, core_id, class_code, name, geom, is_active, deleted_at, core_snapshot
)
SELECT 'osm:way:9100000012', 9100000012, 'yes', 'DEL_ARCHIVE', g.geom, true, NULL, '{}'::jsonb
FROM _g g;
INSERT INTO tile_source.buildings_suppressed (feature_key, reason)
VALUES ('osm:way:9100000012', 'delete');

INSERT INTO tile_source.land_areas_archive (
  feature_key, core_id, class_code, name, geom, is_active, deleted_at, core_snapshot
)
SELECT 'osm:way:9200000012', 9200000012, 'residential', 'LAND_DEL_ARCHIVE', g.geom, true, NULL, '{}'::jsonb
FROM _g g;
INSERT INTO tile_source.land_areas_suppressed (feature_key, reason)
VALUES ('osm:way:9200000012', 'delete');

-- 3) Core + suppression -> absent (even if Core row is still active)
INSERT INTO tile_source.buildings_core (
  feature_key, core_id, class_code, name, geom, is_active, deleted_at
)
SELECT 'osm:way:9100000013', 9100000013, 'yes', 'DEL_CORE', g.geom, true, NULL
FROM _g g;
INSERT INTO tile_source.buildings_suppressed (feature_key, reason)
VALUES ('osm:way:9100000013', 'delete');

INSERT INTO tile_source.land_areas_core (
  feature_key, core_id, class_code, name, geom, is_active, deleted_at
)
SELECT 'osm:way:9200000013', 9200000013, 'residential', 'LAND_DEL_CORE', g.geom, true, NULL
FROM _g g;
INSERT INTO tile_source.land_areas_suppressed (feature_key, reason)
VALUES ('osm:way:9200000013', 'delete');

-- 4) Demote analog: Archive, no suppression -> Archive renders
INSERT INTO tile_source.buildings_archive (
  feature_key, core_id, class_code, name, geom, is_active, deleted_at, core_snapshot
)
SELECT 'osm:way:9100000014', 9100000014, 'yes', 'DEMOTE_ARCHIVE', g.geom, true, NULL, '{}'::jsonb
FROM _g g;
INSERT INTO tile_source.buildings_base (
  external_id, osm_feature_type, osm_id, source_snapshot_id,
  class_code, canonical_name, normalized_data, source_refs, geom
)
SELECT 'osm:way:9100000014', 'way', 9100000014, 1, 'yes', 'DEMOTE_BASE', '{}'::jsonb, '{}'::jsonb, g.geom
FROM _g g;

INSERT INTO tile_source.land_areas_archive (
  feature_key, core_id, class_code, name, geom, is_active, deleted_at, core_snapshot
)
SELECT 'osm:way:9200000014', 9200000014, 'residential', 'LAND_DEMOTE_ARCHIVE', g.geom, true, NULL, '{}'::jsonb
FROM _g g;
INSERT INTO tile_source.land_areas_base (
  external_id, osm_feature_type, osm_id, source_snapshot_id,
  class_code, canonical_name, import_class, normalized_data, source_refs, geom
)
SELECT 'osm:way:9200000014', 'way', 9200000014, 1, 'residential', 'LAND_DEMOTE_BASE', 'residential', '{}'::jsonb, '{}'::jsonb, g.geom
FROM _g g;

\echo '=== assert delete / demote resolution ==='
DO $$
DECLARE
  n bigint;
  src text;
  dup int;
BEGIN
  SELECT count(*) INTO n FROM tile_source.buildings_v WHERE feature_key = 'osm:way:9100000011';
  IF n <> 0 THEN RAISE EXCEPTION 'buildings Base+Delete expected absent, got %', n; END IF;
  SELECT count(*) INTO n FROM tile_source.land_areas_v WHERE feature_key = 'osm:way:9200000011';
  IF n <> 0 THEN RAISE EXCEPTION 'land Base+Delete expected absent, got %', n; END IF;

  SELECT count(*) INTO n FROM tile_source.buildings_v WHERE feature_key = 'osm:way:9100000012';
  IF n <> 0 THEN RAISE EXCEPTION 'buildings Archive+Delete expected absent, got %', n; END IF;
  SELECT count(*) INTO n FROM tile_source.land_areas_v WHERE feature_key = 'osm:way:9200000012';
  IF n <> 0 THEN RAISE EXCEPTION 'land Archive+Delete expected absent, got %', n; END IF;

  SELECT count(*) INTO n FROM tile_source.buildings_v WHERE feature_key = 'osm:way:9100000013';
  IF n <> 0 THEN RAISE EXCEPTION 'buildings Core+Delete expected absent, got %', n; END IF;
  SELECT count(*) INTO n FROM tile_source.land_areas_v WHERE feature_key = 'osm:way:9200000013';
  IF n <> 0 THEN RAISE EXCEPTION 'land Core+Delete expected absent, got %', n; END IF;

  SELECT source INTO src FROM tile_source.buildings_v WHERE feature_key = 'osm:way:9100000014';
  IF src IS DISTINCT FROM 'archive' THEN
    RAISE EXCEPTION 'buildings Demote expected archive, got %', src;
  END IF;
  SELECT source INTO src FROM tile_source.land_areas_v WHERE feature_key = 'osm:way:9200000014';
  IF src IS DISTINCT FROM 'archive' THEN
    RAISE EXCEPTION 'land Demote expected archive, got %', src;
  END IF;

  BEGIN
    INSERT INTO tile_source.buildings_suppressed (feature_key, reason)
    VALUES ('osm:way:9100000011', 'delete');
    RAISE EXCEPTION 'duplicate building suppression should be impossible';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  BEGIN
    INSERT INTO tile_source.land_areas_suppressed (feature_key, reason)
    VALUES ('osm:way:9200000011', 'delete');
    RAISE EXCEPTION 'duplicate land suppression should be impossible';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  SELECT count(*) INTO dup FROM tile_source.buildings_suppressed WHERE feature_key = 'osm:way:9100000011';
  IF dup <> 1 THEN RAISE EXCEPTION 'expected 1 building suppression, got %', dup; END IF;

  RAISE NOTICE '026 delete/demote/idempotent cases OK';
END $$;

ROLLBACK;
