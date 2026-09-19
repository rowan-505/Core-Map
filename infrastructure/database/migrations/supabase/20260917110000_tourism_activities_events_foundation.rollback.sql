-- =============================================================================
-- Rollback: 20260917110000_tourism_activities_events_foundation.sql
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

DROP TABLE IF EXISTS tourism.event_occurrences;
DROP TABLE IF EXISTS tourism.events;
DROP TABLE IF EXISTS tourism.activities;
DROP TABLE IF EXISTS ref.ref_event_types;
DROP TABLE IF EXISTS ref.ref_activity_types;

COMMIT;
