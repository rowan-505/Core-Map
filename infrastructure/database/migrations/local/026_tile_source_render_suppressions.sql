-- =============================================================================
-- Local-only migration 026: render suppression cache + resolved-view precedence
--
-- Target DB: coremap_tiles. Never apply to Supabase.
-- Requires 023–025.
--
-- Precedence:
--   suppression (and legacy Core deleted_at tombstone)
--   > active Core
--   > Archive
--   > Base
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS tile_source;

CREATE TABLE IF NOT EXISTS tile_source.buildings_suppressed (
  feature_key   text        NOT NULL,
  reason        text        NOT NULL DEFAULT 'delete',
  created_at    timestamptz,
  created_by    bigint,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tile_buildings_suppressed_pk PRIMARY KEY (feature_key),
  CONSTRAINT tile_buildings_suppressed_feature_key_chk
    CHECK (btrim(feature_key) <> '')
);

CREATE TABLE IF NOT EXISTS tile_source.land_areas_suppressed (
  feature_key   text        NOT NULL,
  reason        text        NOT NULL DEFAULT 'delete',
  created_at    timestamptz,
  created_by    bigint,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tile_land_areas_suppressed_pk PRIMARY KEY (feature_key),
  CONSTRAINT tile_land_areas_suppressed_feature_key_chk
    CHECK (btrim(feature_key) <> '')
);

COMMENT ON TABLE tile_source.buildings_suppressed IS
  'Refreshable copy of core.core_building_render_suppressions. Highest render precedence.';

COMMENT ON TABLE tile_source.land_areas_suppressed IS
  'Refreshable copy of core.core_land_area_render_suppressions. Highest render precedence.';

CREATE OR REPLACE VIEW tile_source.buildings_v AS
WITH
suppressed AS (
  SELECT s.feature_key
  FROM tile_source.buildings_suppressed AS s
  UNION
  SELECT c.feature_key
  FROM tile_source.buildings_core AS c
  WHERE c.deleted_at IS NOT NULL
),
core_active AS (
  SELECT
    c.feature_key,
    'core'::text AS source,
    c.core_id,
    c.core_public_id,
    c.class_code,
    c.name,
    c.name_mm,
    c.name_en,
    c.geom,
    1 AS priority
  FROM tile_source.buildings_core AS c
  WHERE c.is_active IS TRUE
    AND c.deleted_at IS NULL
    AND c.geom IS NOT NULL
    AND NOT ST_IsEmpty(c.geom)
    AND NOT EXISTS (
      SELECT 1 FROM suppressed AS x WHERE x.feature_key = c.feature_key
    )
),
archive_latest AS (
  SELECT DISTINCT ON (a.feature_key)
    a.feature_key,
    'archive'::text AS source,
    a.core_id,
    a.core_public_id,
    a.class_code,
    a.name,
    a.name_mm,
    a.name_en,
    a.geom,
    2 AS priority
  FROM tile_source.buildings_archive AS a
  WHERE a.geom IS NOT NULL
    AND NOT ST_IsEmpty(a.geom)
    AND NOT EXISTS (
      SELECT 1 FROM suppressed AS x WHERE x.feature_key = a.feature_key
    )
  ORDER BY a.feature_key, a.demoted_at DESC NULLS LAST, a.id DESC
),
base_rows AS (
  SELECT
    ('osm:' || b.osm_feature_type || ':' || b.osm_id::text) AS feature_key,
    'base'::text AS source,
    NULL::bigint AS core_id,
    NULL::uuid AS core_public_id,
    b.class_code,
    b.canonical_name AS name,
    NULL::text AS name_mm,
    NULL::text AS name_en,
    b.geom,
    3 AS priority
  FROM tile_source.buildings_base AS b
  WHERE b.osm_feature_type IS NOT NULL
    AND b.osm_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM suppressed AS x
      WHERE x.feature_key = ('osm:' || b.osm_feature_type || ':' || b.osm_id::text)
    )
),
candidates AS (
  SELECT * FROM core_active
  UNION ALL
  SELECT * FROM archive_latest
  UNION ALL
  SELECT * FROM base_rows
)
SELECT DISTINCT ON (feature_key)
  feature_key,
  source,
  core_id,
  core_public_id,
  class_code,
  name,
  name_mm,
  name_en,
  geom
FROM candidates
ORDER BY feature_key, priority;

COMMENT ON VIEW tile_source.buildings_v IS
  'Resolved buildings for PMTiles: suppression > active Core > Archive > Base.';

CREATE OR REPLACE VIEW tile_source.land_areas_v AS
WITH
suppressed AS (
  SELECT s.feature_key
  FROM tile_source.land_areas_suppressed AS s
  UNION
  SELECT c.feature_key
  FROM tile_source.land_areas_core AS c
  WHERE c.deleted_at IS NOT NULL
),
core_active AS (
  SELECT
    c.feature_key,
    'core'::text AS source,
    c.core_id,
    c.core_public_id,
    c.class_code,
    c.name,
    c.name_mm,
    c.name_en,
    c.geom,
    1 AS priority
  FROM tile_source.land_areas_core AS c
  WHERE c.is_active IS TRUE
    AND c.deleted_at IS NULL
    AND c.geom IS NOT NULL
    AND NOT ST_IsEmpty(c.geom)
    AND NOT EXISTS (
      SELECT 1 FROM suppressed AS x WHERE x.feature_key = c.feature_key
    )
),
archive_latest AS (
  SELECT DISTINCT ON (a.feature_key)
    a.feature_key,
    'archive'::text AS source,
    a.core_id,
    a.core_public_id,
    a.class_code,
    a.name,
    a.name_mm,
    a.name_en,
    a.geom,
    2 AS priority
  FROM tile_source.land_areas_archive AS a
  WHERE a.geom IS NOT NULL
    AND NOT ST_IsEmpty(a.geom)
    AND NOT EXISTS (
      SELECT 1 FROM suppressed AS x WHERE x.feature_key = a.feature_key
    )
  ORDER BY a.feature_key, a.demoted_at DESC NULLS LAST, a.id DESC
),
base_rows AS (
  SELECT
    ('osm:' || b.osm_feature_type || ':' || b.osm_id::text) AS feature_key,
    'base'::text AS source,
    NULL::bigint AS core_id,
    NULL::uuid AS core_public_id,
    b.class_code,
    b.canonical_name AS name,
    NULL::text AS name_mm,
    NULL::text AS name_en,
    b.geom,
    3 AS priority
  FROM tile_source.land_areas_base AS b
  WHERE b.osm_feature_type IS NOT NULL
    AND b.osm_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM suppressed AS x
      WHERE x.feature_key = ('osm:' || b.osm_feature_type || ':' || b.osm_id::text)
    )
),
candidates AS (
  SELECT * FROM core_active
  UNION ALL
  SELECT * FROM archive_latest
  UNION ALL
  SELECT * FROM base_rows
)
SELECT DISTINCT ON (feature_key)
  feature_key,
  source,
  core_id,
  core_public_id,
  class_code,
  name,
  name_mm,
  name_en,
  geom
FROM candidates
ORDER BY feature_key, priority;

COMMENT ON VIEW tile_source.land_areas_v IS
  'Resolved land areas for PMTiles: suppression > active Core > Archive > Base.';

COMMIT;
