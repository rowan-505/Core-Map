-- =============================================================================
-- Rollback: 20260917090000_tourism_place_candidate_ignores.sql
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

DROP TABLE IF EXISTS tourism.place_candidate_ignores;

COMMIT;
