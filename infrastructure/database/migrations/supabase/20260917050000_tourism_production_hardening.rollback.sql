-- Rollback for 20260917050000_tourism_production_hardening.sql
-- Restores mutable search_path and drops actor FK covering indexes.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '2min';

DROP INDEX IF EXISTS tourism.place_profiles_created_by_idx;
DROP INDEX IF EXISTS tourism.place_profiles_updated_by_idx;

ALTER FUNCTION tourism.set_updated_at() RESET search_path;
ALTER FUNCTION tourism.reject_moderation_event_mutation() RESET search_path;
ALTER FUNCTION tourism.place_reviews_before_write() RESET search_path;
ALTER FUNCTION tourism.refresh_place_rating_summary(bigint) RESET search_path;
ALTER FUNCTION tourism.place_reviews_refresh_summary() RESET search_path;

RESET lock_timeout;
RESET statement_timeout;

COMMIT;
