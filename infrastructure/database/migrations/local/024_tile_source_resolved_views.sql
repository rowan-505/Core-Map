-- =============================================================================
-- Local-only migration 024: resolved tile_source buildings / land_areas views
--
-- Target DB: coremap_tiles. Never apply to Supabase.
--
-- Priority for the same canonical feature_key:
--   1) active Core   (is_active AND deleted_at IS NULL)
--   2) Archive       (latest demoted_at)
--   3) Base
--
-- Tombstone (Core deleted_at IS NOT NULL):
--   feature must not render from Core, Archive, or Base.
--
-- Demotion (no Core row, Archive present):
--   Archive renders (feature continues).
--
-- Base feature_key is derived as osm:<osm_feature_type>:<osm_id>.
-- Requires 022 (*_base) and 023 (*_core / *_archive).
--
-- Usage:
--   psql "$COREMAP_TILES_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f infrastructure/database/migrations/local/024_tile_source_resolved_views.sql
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS tile_source;

-- ---------------------------------------------------------------------------
-- buildings_v
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW tile_source.buildings_v AS
WITH
tombstone AS (
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
    SELECT 1 FROM tombstone AS t WHERE t.feature_key = a.feature_key
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
      FROM tombstone AS t
      WHERE t.feature_key = ('osm:' || b.osm_feature_type || ':' || b.osm_id::text)
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
  'Resolved buildings for PMTiles: active Core > Archive > Base. '
  'Core deleted_at tombstone suppresses all sources for that feature_key. '
  'Local migration 026 adds identity-only render suppression with higher precedence.';

-- ---------------------------------------------------------------------------
-- land_areas_v
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW tile_source.land_areas_v AS
WITH
tombstone AS (
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
    SELECT 1 FROM tombstone AS t WHERE t.feature_key = a.feature_key
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
      FROM tombstone AS t
      WHERE t.feature_key = ('osm:' || b.osm_feature_type || ':' || b.osm_id::text)
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
  'Resolved land areas for PMTiles: active Core > Archive > Base. '
  'Core deleted_at tombstone suppresses all sources for that feature_key. '
  'Local migration 026 adds identity-only render suppression with higher precedence.';

COMMIT;
