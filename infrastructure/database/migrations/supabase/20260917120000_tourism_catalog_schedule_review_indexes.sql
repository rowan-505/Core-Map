-- =============================================================================
-- 20260917120000_tourism_catalog_schedule_review_indexes.sql
-- -----------------------------------------------------------------------------
-- Phase 6: Index hardening for Need Review + occurrence LATERAL lookups.
-- No schema/data model changes.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

-- Activities / events: Need Review filters on requires_schedule_review + due date
CREATE INDEX IF NOT EXISTS activities_schedule_review_due_idx
    ON tourism.activities (next_review_due_at ASC NULLS FIRST, id)
    WHERE requires_schedule_review IS TRUE;

CREATE INDEX IF NOT EXISTS events_schedule_review_due_idx
    ON tourism.events (next_review_due_at ASC NULLS FIRST, id)
    WHERE requires_schedule_review IS TRUE;

-- Occurrences: next/last LATERAL and missing-next NOT EXISTS
CREATE INDEX IF NOT EXISTS event_occurrences_event_status_starts_idx
    ON tourism.event_occurrences (event_id, status, starts_at);

CREATE INDEX IF NOT EXISTS event_occurrences_event_status_ends_idx
    ON tourism.event_occurrences (event_id, status, ends_at);

COMMIT;
