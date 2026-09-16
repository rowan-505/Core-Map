-- =============================================================================
-- Local-only migration 025: allow NULL geom on Core cache tombstones
--
-- buildings_core / land_areas_core must store deleted ownership rows even when
-- geometry is missing, so resolved views can suppress Base/Archive.
-- Active rows still require geom.
-- =============================================================================

BEGIN;

ALTER TABLE IF EXISTS tile_source.buildings_core
  ALTER COLUMN geom DROP NOT NULL;

ALTER TABLE IF EXISTS tile_source.land_areas_core
  ALTER COLUMN geom DROP NOT NULL;

ALTER TABLE tile_source.buildings_core
  DROP CONSTRAINT IF EXISTS tile_buildings_core_active_geom_chk;

ALTER TABLE tile_source.buildings_core
  ADD CONSTRAINT tile_buildings_core_active_geom_chk
  CHECK (deleted_at IS NOT NULL OR geom IS NOT NULL);

ALTER TABLE tile_source.land_areas_core
  DROP CONSTRAINT IF EXISTS tile_land_areas_core_active_geom_chk;

ALTER TABLE tile_source.land_areas_core
  ADD CONSTRAINT tile_land_areas_core_active_geom_chk
  CHECK (deleted_at IS NOT NULL OR geom IS NOT NULL);

COMMIT;
