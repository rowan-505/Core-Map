-- =============================================================================
-- 20260917090000_tourism_place_candidate_ignores.sql
-- -----------------------------------------------------------------------------
-- Phase 6: minimal durable ignore list for tourism curation candidates.
-- Candidates themselves are query-time (core places − profiles − ignores).
-- No auto-import of tourism profiles.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS tourism.place_candidate_ignores (
    place_id    bigint      PRIMARY KEY
        REFERENCES core.core_places (id) ON DELETE CASCADE ON UPDATE CASCADE,
    ignored_by  bigint      NULL
        REFERENCES app_auth.auth_users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    reason      text        NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT place_candidate_ignores_reason_len_chk
        CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS place_candidate_ignores_created_at_idx
    ON tourism.place_candidate_ignores (created_at DESC);

COMMENT ON TABLE tourism.place_candidate_ignores IS
    'Places a tourism curator rejected/ignored so they do not reappear in candidate lists. Not a full workflow queue.';

COMMIT;
