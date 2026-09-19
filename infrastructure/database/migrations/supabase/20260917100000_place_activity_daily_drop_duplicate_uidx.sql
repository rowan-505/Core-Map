-- =============================================================================
-- 20260917100000_place_activity_daily_drop_duplicate_uidx.sql
-- -----------------------------------------------------------------------------
-- Phase 7 cleanup: drop duplicate unique index identical to PRIMARY KEY
-- (place_id, activity_date). Reported by Supabase performance advisor.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

DROP INDEX IF EXISTS app.place_activity_daily_place_date_uidx;

COMMIT;
