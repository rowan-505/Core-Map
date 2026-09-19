-- =============================================================================
-- 20260917050000_tourism_production_hardening.sql
-- -----------------------------------------------------------------------------
-- Tourism-only production hardening. Does not change unrelated schemas/tables.
--
-- 1) Pin search_path on tourism trigger/helper functions (security advisor).
-- 2) Cover place_profiles actor foreign keys for delete/join performance.
--
-- Access model unchanged:
--   RLS enabled, no anon/authenticated policies, schema revoked from public clients.
--   Fastify/Prisma (postgres role) remains the only application accessor.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '2min';

-- ----------------------------------------------------------------------------
-- 1. Pin function search_path
-- ----------------------------------------------------------------------------
ALTER FUNCTION tourism.set_updated_at()
    SET search_path TO pg_catalog, extensions, tourism, core, app_auth;

ALTER FUNCTION tourism.reject_moderation_event_mutation()
    SET search_path TO pg_catalog, extensions, tourism, core, app_auth;

ALTER FUNCTION tourism.place_reviews_before_write()
    SET search_path TO pg_catalog, extensions, tourism, core, app_auth;

ALTER FUNCTION tourism.refresh_place_rating_summary(bigint)
    SET search_path TO pg_catalog, extensions, tourism, core, app_auth;

ALTER FUNCTION tourism.place_reviews_refresh_summary()
    SET search_path TO pg_catalog, extensions, tourism, core, app_auth;

-- ----------------------------------------------------------------------------
-- 2. Cover actor FK columns on place_profiles
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS place_profiles_created_by_idx
    ON tourism.place_profiles (created_by)
    WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS place_profiles_updated_by_idx
    ON tourism.place_profiles (updated_by)
    WHERE updated_by IS NOT NULL;

-- Reaffirm privilege lock (idempotent; tourism-only).
REVOKE ALL ON SCHEMA tourism FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA tourism FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tourism FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tourism FROM PUBLIC, anon, authenticated;

RESET lock_timeout;
RESET statement_timeout;

COMMIT;
