-- =============================================================================
-- Local-only migration 023: minimal tile_source cache / archive / sync tables
--
-- Target DB: coremap_tiles (Windows/WSL permanent PMTiles machine).
-- Never apply to Supabase. Does not modify core / search / tiles app schemas.
--
-- Roles:
--   *_base     = permanent large local bulk baseline (created in 022)
--   *_core     = refreshable Supabase-managed cache (buildings / land_areas)
--   *_archive  = previously Core-managed feature intentionally demoted to local
--   other      = refreshable Supabase snapshots for PMTiles layers
--   sync_state = small sync metadata
--
-- No triggers, queues, ETL framework, jobs, or promotion commands.
-- Idempotent: CREATE SCHEMA / TABLE / INDEX IF NOT EXISTS only.
--
-- Usage:
--   psql "$COREMAP_TILES_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f infrastructure/database/migrations/local/023_tile_source_cache_archive_tables.sql
--   psql "$COREMAP_TILES_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f infrastructure/database/migrations/local/023_tile_source_tables_validate.sql
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS tile_source;

COMMENT ON SCHEMA tile_source IS
  'Local permanent PMTiles sources: *_base bulk, *_core Supabase cache, '
  '*_archive demotion preservation, and refreshable layer snapshots. Not Supabase.';

-- ---------------------------------------------------------------------------
-- sync_state — one row per dataset key
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tile_source.sync_state (
  dataset         text PRIMARY KEY,
  last_synced_at  timestamptz,
  source          text,
  row_count       bigint,
  content_hash    text,
  notes           text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tile_sync_state_dataset_chk CHECK (btrim(dataset) <> '')
);

COMMENT ON TABLE tile_source.sync_state IS
  'Sync metadata for tile_source refreshable datasets. No job runner.';

-- ---------------------------------------------------------------------------
-- buildings_core — Supabase-managed building cache for PMTiles override/merge
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tile_source.buildings_core (
  feature_key     text NOT NULL,
  core_id         bigint,
  core_public_id  uuid,
  class_code      text NOT NULL,
  name            text,
  name_mm         text,
  name_en         text,
  geom            geometry(MultiPolygon, 4326) NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  deleted_at      timestamptz,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tile_buildings_core_feature_key_chk
    CHECK (btrim(feature_key) <> ''),
  CONSTRAINT tile_buildings_core_class_code_chk
    CHECK (btrim(class_code) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS tile_buildings_core_feature_key_uidx
  ON tile_source.buildings_core (feature_key);

CREATE UNIQUE INDEX IF NOT EXISTS tile_buildings_core_core_id_uidx
  ON tile_source.buildings_core (core_id)
  WHERE core_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tile_buildings_core_geom_gix
  ON tile_source.buildings_core USING gist (geom);

CREATE INDEX IF NOT EXISTS tile_buildings_core_active_idx
  ON tile_source.buildings_core (is_active)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE tile_source.buildings_core IS
  'Refreshable Supabase Core building cache. feature_key is canonical (osm:way|relation:<id>).';

-- ---------------------------------------------------------------------------
-- land_areas_core — Supabase-managed land-area cache
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tile_source.land_areas_core (
  feature_key     text NOT NULL,
  core_id         bigint,
  core_public_id  uuid,
  class_code      text NOT NULL,
  name            text,
  name_mm         text,
  name_en         text,
  geom            geometry(MultiPolygon, 4326) NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  deleted_at      timestamptz,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tile_land_areas_core_feature_key_chk
    CHECK (btrim(feature_key) <> ''),
  CONSTRAINT tile_land_areas_core_class_code_chk
    CHECK (btrim(class_code) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS tile_land_areas_core_feature_key_uidx
  ON tile_source.land_areas_core (feature_key);

CREATE UNIQUE INDEX IF NOT EXISTS tile_land_areas_core_core_id_uidx
  ON tile_source.land_areas_core (core_id)
  WHERE core_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tile_land_areas_core_geom_gix
  ON tile_source.land_areas_core USING gist (geom);

CREATE INDEX IF NOT EXISTS tile_land_areas_core_active_idx
  ON tile_source.land_areas_core (is_active)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE tile_source.land_areas_core IS
  'Refreshable Supabase Core land-area cache. feature_key is canonical (osm:way|relation:<id>).';

-- ---------------------------------------------------------------------------
-- buildings_archive / land_areas_archive — demotion preservation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tile_source.buildings_archive (
  id              bigserial PRIMARY KEY,
  feature_key     text NOT NULL,
  core_id         bigint,
  core_public_id  uuid,
  class_code      text,
  name            text,
  name_mm         text,
  name_en         text,
  geom            geometry(MultiPolygon, 4326) NOT NULL,
  is_active       boolean,
  deleted_at      timestamptz,
  core_snapshot   jsonb NOT NULL DEFAULT '{}'::jsonb,
  demotion_reason text,
  demoted_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tile_buildings_archive_feature_key_chk
    CHECK (btrim(feature_key) <> '')
);

CREATE INDEX IF NOT EXISTS tile_buildings_archive_feature_key_idx
  ON tile_source.buildings_archive (feature_key);

CREATE INDEX IF NOT EXISTS tile_buildings_archive_core_id_idx
  ON tile_source.buildings_archive (core_id)
  WHERE core_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tile_buildings_archive_geom_gix
  ON tile_source.buildings_archive USING gist (geom);

COMMENT ON TABLE tile_source.buildings_archive IS
  'Demoted Core buildings kept locally for later restore. core_snapshot holds restore payload.';

CREATE TABLE IF NOT EXISTS tile_source.land_areas_archive (
  id              bigserial PRIMARY KEY,
  feature_key     text NOT NULL,
  core_id         bigint,
  core_public_id  uuid,
  class_code      text,
  name            text,
  name_mm         text,
  name_en         text,
  geom            geometry(MultiPolygon, 4326) NOT NULL,
  is_active       boolean,
  deleted_at      timestamptz,
  core_snapshot   jsonb NOT NULL DEFAULT '{}'::jsonb,
  demotion_reason text,
  demoted_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tile_land_areas_archive_feature_key_chk
    CHECK (btrim(feature_key) <> '')
);

CREATE INDEX IF NOT EXISTS tile_land_areas_archive_feature_key_idx
  ON tile_source.land_areas_archive (feature_key);

CREATE INDEX IF NOT EXISTS tile_land_areas_archive_core_id_idx
  ON tile_source.land_areas_archive (core_id)
  WHERE core_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tile_land_areas_archive_geom_gix
  ON tile_source.land_areas_archive USING gist (geom);

COMMENT ON TABLE tile_source.land_areas_archive IS
  'Demoted Core land areas kept locally for later restore. core_snapshot holds restore payload.';

-- ---------------------------------------------------------------------------
-- Refreshable Supabase snapshots (static PMTiles layers)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tile_source.streets (
  core_id           bigint NOT NULL,
  core_public_id    uuid,
  feature_key       text,
  name              text,
  name_mm           text,
  name_en           text,
  road_class_code   text NOT NULL DEFAULT 'unknown',
  min_zoom          numeric NOT NULL DEFAULT 12,
  sort_rank         integer NOT NULL DEFAULT 100,
  surface           text,
  is_oneway         boolean NOT NULL DEFAULT false,
  bridge            boolean NOT NULL DEFAULT false,
  tunnel            boolean NOT NULL DEFAULT false,
  layer             integer NOT NULL DEFAULT 0,
  geom              geometry(LineString, 4326) NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  deleted_at        timestamptz,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tile_streets_core_id_pkey PRIMARY KEY (core_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS tile_streets_feature_key_uidx
  ON tile_source.streets (feature_key)
  WHERE feature_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS tile_streets_geom_gix
  ON tile_source.streets USING gist (geom);

CREATE INDEX IF NOT EXISTS tile_streets_road_class_idx
  ON tile_source.streets (road_class_code);

COMMENT ON TABLE tile_source.streets IS
  'Refreshable Supabase street snapshot for PMTiles.';

CREATE TABLE IF NOT EXISTS tile_source.settlements (
  core_id           bigint NOT NULL,
  core_public_id    uuid,
  settlement_type   text NOT NULL,
  name              text,
  name_mm           text,
  name_en           text,
  importance_score  numeric,
  min_zoom          numeric NOT NULL DEFAULT 12,
  geom              geometry(Point, 4326) NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  deleted_at        timestamptz,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tile_settlements_core_id_pkey PRIMARY KEY (core_id),
  CONSTRAINT tile_settlements_type_chk CHECK (btrim(settlement_type) <> '')
);

CREATE INDEX IF NOT EXISTS tile_settlements_geom_gix
  ON tile_source.settlements USING gist (geom);

CREATE INDEX IF NOT EXISTS tile_settlements_type_idx
  ON tile_source.settlements (settlement_type);

COMMENT ON TABLE tile_source.settlements IS
  'Refreshable Supabase settlement label snapshot for PMTiles.';

CREATE TABLE IF NOT EXISTS tile_source.admin_areas (
  core_id           bigint NOT NULL,
  core_public_id    uuid,
  name              text,
  name_mm           text,
  name_en           text,
  admin_level_code  text NOT NULL,
  boundary_status   text,
  geom              geometry(MultiPolygon, 4326) NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  deleted_at        timestamptz,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tile_admin_areas_core_id_pkey PRIMARY KEY (core_id),
  CONSTRAINT tile_admin_areas_level_chk CHECK (btrim(admin_level_code) <> '')
);

CREATE INDEX IF NOT EXISTS tile_admin_areas_geom_gix
  ON tile_source.admin_areas USING gist (geom);

CREATE INDEX IF NOT EXISTS tile_admin_areas_level_idx
  ON tile_source.admin_areas (admin_level_code);

COMMENT ON TABLE tile_source.admin_areas IS
  'Refreshable Supabase admin polygon snapshot for PMTiles.';

CREATE TABLE IF NOT EXISTS tile_source.admin_labels (
  core_id           bigint NOT NULL,
  core_public_id    uuid,
  name              text,
  name_mm           text,
  name_en           text,
  admin_level_code  text NOT NULL,
  geom              geometry(Point, 4326) NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  deleted_at        timestamptz,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tile_admin_labels_core_id_pkey PRIMARY KEY (core_id),
  CONSTRAINT tile_admin_labels_level_chk CHECK (btrim(admin_level_code) <> '')
);

CREATE INDEX IF NOT EXISTS tile_admin_labels_geom_gix
  ON tile_source.admin_labels USING gist (geom);

CREATE INDEX IF NOT EXISTS tile_admin_labels_level_idx
  ON tile_source.admin_labels (admin_level_code);

COMMENT ON TABLE tile_source.admin_labels IS
  'Refreshable Supabase admin label-point snapshot for PMTiles.';

CREATE TABLE IF NOT EXISTS tile_source.water_lines (
  core_id           bigint NOT NULL,
  core_public_id    uuid,
  name              text,
  class_code        text NOT NULL,
  geom              geometry(LineString, 4326) NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  deleted_at        timestamptz,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tile_water_lines_core_id_pkey PRIMARY KEY (core_id),
  CONSTRAINT tile_water_lines_class_chk CHECK (btrim(class_code) <> '')
);

CREATE INDEX IF NOT EXISTS tile_water_lines_geom_gix
  ON tile_source.water_lines USING gist (geom);

COMMENT ON TABLE tile_source.water_lines IS
  'Refreshable Supabase water-line snapshot for PMTiles.';

CREATE TABLE IF NOT EXISTS tile_source.water_polygons (
  core_id           bigint NOT NULL,
  core_public_id    uuid,
  name              text,
  class_code        text NOT NULL,
  geom              geometry(MultiPolygon, 4326) NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  deleted_at        timestamptz,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tile_water_polygons_core_id_pkey PRIMARY KEY (core_id),
  CONSTRAINT tile_water_polygons_class_chk CHECK (btrim(class_code) <> '')
);

CREATE INDEX IF NOT EXISTS tile_water_polygons_geom_gix
  ON tile_source.water_polygons USING gist (geom);

COMMENT ON TABLE tile_source.water_polygons IS
  'Refreshable Supabase water-polygon snapshot for PMTiles.';

CREATE TABLE IF NOT EXISTS tile_source.coastlines (
  core_id             bigint NOT NULL,
  core_public_id      uuid,
  region_code         text,
  geom                geometry(MultiLineString, 4326) NOT NULL,
  is_active           boolean NOT NULL DEFAULT true,
  deleted_at          timestamptz,
  synced_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tile_coastlines_core_id_pkey PRIMARY KEY (core_id)
);

CREATE INDEX IF NOT EXISTS tile_coastlines_geom_gix
  ON tile_source.coastlines USING gist (geom);

CREATE INDEX IF NOT EXISTS tile_coastlines_region_idx
  ON tile_source.coastlines (region_code);

COMMENT ON TABLE tile_source.coastlines IS
  'Refreshable Supabase coastline snapshot for PMTiles.';

CREATE TABLE IF NOT EXISTS tile_source.protected_areas (
  core_id           bigint NOT NULL,
  core_public_id    uuid,
  feature_key       text,
  class_code        text NOT NULL,
  name              text,
  name_mm           text,
  name_en           text,
  geom              geometry(MultiPolygon, 4326) NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  deleted_at        timestamptz,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tile_protected_areas_core_id_pkey PRIMARY KEY (core_id),
  CONSTRAINT tile_protected_areas_class_chk CHECK (btrim(class_code) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS tile_protected_areas_feature_key_uidx
  ON tile_source.protected_areas (feature_key)
  WHERE feature_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS tile_protected_areas_geom_gix
  ON tile_source.protected_areas USING gist (geom);

COMMENT ON TABLE tile_source.protected_areas IS
  'Refreshable Supabase protected-area snapshot for PMTiles.';

-- Seed sync_state keys (metadata only; no data sync).
INSERT INTO tile_source.sync_state (dataset, notes)
VALUES
  ('buildings_core', 'Supabase-managed building cache'),
  ('land_areas_core', 'Supabase-managed land-area cache'),
  ('streets', 'Supabase street snapshot'),
  ('settlements', 'Supabase settlement snapshot'),
  ('admin_areas', 'Supabase admin polygon snapshot'),
  ('admin_labels', 'Supabase admin label snapshot'),
  ('water_lines', 'Supabase water-line snapshot'),
  ('water_polygons', 'Supabase water-polygon snapshot'),
  ('coastlines', 'Supabase coastline snapshot'),
  ('protected_areas', 'Supabase protected-area snapshot')
ON CONFLICT (dataset) DO NOTHING;

COMMIT;
