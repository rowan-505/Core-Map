-- =============================================================================
-- Local-only migration 022: permanent bulk tables under tile_source
--
-- Target DB: coremap_tiles (Windows/WSL permanent PMTiles machine).
-- Never apply to Supabase. Does not modify core / search / tiles app schemas.
--
-- Safe move/rename only (no row delete, no data rewrite):
--   basemap_source.buildings   -> tile_source.buildings_base
--   basemap_source.land_areas  -> tile_source.land_areas_base
--
-- Identity:
--   Existing (osm_feature_type, osm_id) + unique external_id are sufficient.
--   Canonical examples: osm:way:123456 / osm:relation:789
--   No feature_key column is added.
--
-- Idempotent:
--   - Creates tile_source schema if needed
--   - Moves source tables when present and targets absent
--   - No-ops when targets already exist and sources are gone
--   - Errors if both source and target exist for the same family (ambiguous)
--   - Ensures unique identity + GiST geom indexes
--
-- Usage:
--   # before
--   psql "$COREMAP_TILES_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -c "SELECT set_config('tile_bulk.validate_phase','before',false);" \
--     -f infrastructure/database/migrations/local/022_tile_source_bulk_validate.sql
--
--   # migrate
--   psql "$COREMAP_TILES_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f infrastructure/database/migrations/local/022_tile_source_buildings_land_areas_base.sql
--
--   # after
--   psql "$COREMAP_TILES_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -c "SELECT set_config('tile_bulk.validate_phase','after',false);" \
--     -f infrastructure/database/migrations/local/022_tile_source_bulk_validate.sql
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS tile_source;

COMMENT ON SCHEMA tile_source IS
  'Permanent local PMTiles bulk geometry sources. Not Core. Not Supabase.';

-- ---------------------------------------------------------------------------
-- Move helpers (catalog-only rename; preserves rows, typmod, constraints, indexes)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  src regclass;
  dst regclass;
BEGIN
  -- buildings
  src := to_regclass('basemap_source.buildings');
  dst := to_regclass('tile_source.buildings_base');

  IF src IS NOT NULL AND dst IS NOT NULL THEN
    RAISE EXCEPTION
      '022 refused: both basemap_source.buildings and tile_source.buildings_base exist';
  ELSIF src IS NOT NULL AND dst IS NULL THEN
    EXECUTE 'ALTER TABLE basemap_source.buildings SET SCHEMA tile_source';
    EXECUTE 'ALTER TABLE tile_source.buildings RENAME TO buildings_base';
    RAISE NOTICE '022: moved basemap_source.buildings -> tile_source.buildings_base';
  ELSIF src IS NULL AND dst IS NOT NULL THEN
    RAISE NOTICE '022: tile_source.buildings_base already present (no-op move)';
  ELSE
    RAISE EXCEPTION
      '022 refused: neither basemap_source.buildings nor tile_source.buildings_base exists';
  END IF;

  -- land_areas
  src := to_regclass('basemap_source.land_areas');
  dst := to_regclass('tile_source.land_areas_base');

  IF src IS NOT NULL AND dst IS NOT NULL THEN
    RAISE EXCEPTION
      '022 refused: both basemap_source.land_areas and tile_source.land_areas_base exist';
  ELSIF src IS NOT NULL AND dst IS NULL THEN
    EXECUTE 'ALTER TABLE basemap_source.land_areas SET SCHEMA tile_source';
    EXECUTE 'ALTER TABLE tile_source.land_areas RENAME TO land_areas_base';
    RAISE NOTICE '022: moved basemap_source.land_areas -> tile_source.land_areas_base';
  ELSIF src IS NULL AND dst IS NOT NULL THEN
    RAISE NOTICE '022: tile_source.land_areas_base already present (no-op move)';
  ELSE
    RAISE EXCEPTION
      '022 refused: neither basemap_source.land_areas nor tile_source.land_areas_base exists';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Rename indexes to stable tile_source names (idempotent)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS index_name, t.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_class t ON t.oid = i.indrelid
    WHERE n.nspname = 'tile_source'
      AND t.relname IN ('buildings_base', 'land_areas_base')
      AND c.relkind = 'i'
  LOOP
    -- buildings
    IF r.table_name = 'buildings_base' AND r.index_name = 'basemap_buildings_identity_uidx' THEN
      EXECUTE 'ALTER INDEX tile_source.basemap_buildings_identity_uidx RENAME TO tile_buildings_base_osm_identity_uidx';
    ELSIF r.table_name = 'buildings_base' AND r.index_name = 'basemap_buildings_external_id_uidx' THEN
      EXECUTE 'ALTER INDEX tile_source.basemap_buildings_external_id_uidx RENAME TO tile_buildings_base_external_id_uidx';
    ELSIF r.table_name = 'buildings_base' AND r.index_name = 'basemap_buildings_geom_gix' THEN
      EXECUTE 'ALTER INDEX tile_source.basemap_buildings_geom_gix RENAME TO tile_buildings_base_geom_gix';
    ELSIF r.table_name = 'buildings_base' AND r.index_name = 'basemap_buildings_core_public_id_uidx' THEN
      EXECUTE 'ALTER INDEX tile_source.basemap_buildings_core_public_id_uidx RENAME TO tile_buildings_base_core_public_id_uidx';
    -- land_areas
    ELSIF r.table_name = 'land_areas_base' AND r.index_name = 'basemap_land_areas_identity_uidx' THEN
      EXECUTE 'ALTER INDEX tile_source.basemap_land_areas_identity_uidx RENAME TO tile_land_areas_base_osm_identity_uidx';
    ELSIF r.table_name = 'land_areas_base' AND r.index_name = 'basemap_land_areas_external_id_uidx' THEN
      EXECUTE 'ALTER INDEX tile_source.basemap_land_areas_external_id_uidx RENAME TO tile_land_areas_base_external_id_uidx';
    ELSIF r.table_name = 'land_areas_base' AND r.index_name = 'basemap_land_areas_geom_gix' THEN
      EXECUTE 'ALTER INDEX tile_source.basemap_land_areas_geom_gix RENAME TO tile_land_areas_base_geom_gix';
    ELSIF r.table_name = 'land_areas_base' AND r.index_name = 'basemap_land_areas_class_code_idx' THEN
      EXECUTE 'ALTER INDEX tile_source.basemap_land_areas_class_code_idx RENAME TO tile_land_areas_base_class_code_idx';
    ELSIF r.table_name = 'land_areas_base' AND r.index_name = 'basemap_land_areas_snapshot_idx' THEN
      EXECUTE 'ALTER INDEX tile_source.basemap_land_areas_snapshot_idx RENAME TO tile_land_areas_base_snapshot_idx';
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Ensure efficient identity lookup + GiST geometry indexes
-- (CREATE IF NOT EXISTS; no data rewrite)
-- ---------------------------------------------------------------------------

-- buildings_base: OSM pair identity (partial unique — Core-managed rows may lack OSM ids)
CREATE UNIQUE INDEX IF NOT EXISTS tile_buildings_base_osm_identity_uidx
  ON tile_source.buildings_base (osm_feature_type, osm_id)
  WHERE osm_feature_type IS NOT NULL AND osm_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tile_buildings_base_external_id_uidx
  ON tile_source.buildings_base (external_id);

CREATE INDEX IF NOT EXISTS tile_buildings_base_geom_gix
  ON tile_source.buildings_base USING gist (geom);

-- land_areas_base: required OSM identity on all rows
CREATE UNIQUE INDEX IF NOT EXISTS tile_land_areas_base_osm_identity_uidx
  ON tile_source.land_areas_base (osm_feature_type, osm_id);

CREATE UNIQUE INDEX IF NOT EXISTS tile_land_areas_base_external_id_uidx
  ON tile_source.land_areas_base (external_id);

CREATE INDEX IF NOT EXISTS tile_land_areas_base_geom_gix
  ON tile_source.land_areas_base USING gist (geom);

CREATE INDEX IF NOT EXISTS tile_land_areas_base_class_code_idx
  ON tile_source.land_areas_base (class_code);

CREATE INDEX IF NOT EXISTS tile_land_areas_base_snapshot_idx
  ON tile_source.land_areas_base (source_snapshot_id);

COMMENT ON TABLE tile_source.buildings_base IS
  'Permanent national building footprints for PMTiles. Moved from basemap_source.buildings. Identity: (osm_feature_type, osm_id) and external_id (canonical osm:way|relation:<id>).';

COMMENT ON TABLE tile_source.land_areas_base IS
  'Permanent national land-area polygons for PMTiles. Moved from basemap_source.land_areas. Identity: (osm_feature_type, osm_id) and external_id (canonical osm:way|relation:<id>).';

-- Refuse adding feature_key: existing identity columns are sufficient.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'tile_source'
      AND table_name IN ('buildings_base', 'land_areas_base')
      AND column_name = 'feature_key'
  ) THEN
    RAISE NOTICE '022: feature_key already present (left unchanged)';
  ELSE
    RAISE NOTICE '022: feature_key not added — osm_feature_type+osm_id and external_id are canonical';
  END IF;
END $$;

COMMIT;
