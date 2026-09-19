-- Rollback: 20260917120000_tourism_catalog_schedule_review_indexes.sql

BEGIN;

DROP INDEX IF EXISTS tourism.event_occurrences_event_status_ends_idx;
DROP INDEX IF EXISTS tourism.event_occurrences_event_status_starts_idx;
DROP INDEX IF EXISTS tourism.events_schedule_review_due_idx;
DROP INDEX IF EXISTS tourism.activities_schedule_review_due_idx;

COMMIT;
