-- =============================================================================
-- Supabase migration 206: render suppressions for buildings and land areas
-- =============================================================================
--
-- Durable identity-only hide for the hybrid tile entities (buildings, land
-- areas). Used by DELETE: Base/Archive must not reappear after Core is gone.
--
-- Does NOT store geometry. Does NOT apply to streets, settlements, admin,
-- water, places, or transport.
--
-- Demote must not write these rows.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS core.core_building_render_suppressions (
    feature_key   text        NOT NULL,
    reason        text        NOT NULL DEFAULT 'delete',
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    bigint,
    CONSTRAINT core_building_render_suppressions_pk PRIMARY KEY (feature_key),
    CONSTRAINT core_building_render_suppressions_feature_key_chk
      CHECK (feature_key ~ '^osm:(way|relation):[0-9]+$'),
    CONSTRAINT core_building_render_suppressions_reason_chk
      CHECK (btrim(reason) <> '')
);

CREATE TABLE IF NOT EXISTS core.core_land_area_render_suppressions (
    feature_key   text        NOT NULL,
    reason        text        NOT NULL DEFAULT 'delete',
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    bigint,
    CONSTRAINT core_land_area_render_suppressions_pk PRIMARY KEY (feature_key),
    CONSTRAINT core_land_area_render_suppressions_feature_key_chk
      CHECK (feature_key ~ '^osm:(way|relation):[0-9]+$'),
    CONSTRAINT core_land_area_render_suppressions_reason_chk
      CHECK (btrim(reason) <> '')
);

COMMENT ON TABLE core.core_building_render_suppressions IS
  'Identity-only DELETE hide for buildings. feature_key must not render from Core, Archive, or Base until this row is cleared.';

COMMENT ON TABLE core.core_land_area_render_suppressions IS
  'Identity-only DELETE hide for land areas. feature_key must not render from Core, Archive, or Base until this row is cleared.';

REVOKE ALL ON TABLE core.core_building_render_suppressions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE core.core_land_area_render_suppressions FROM PUBLIC, anon, authenticated;

COMMIT;
