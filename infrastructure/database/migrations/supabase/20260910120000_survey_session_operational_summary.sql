-- Extend survey sessions with operational summary fields and minimal lifecycle events.
-- Does not change transport routes, variants, stops, or report statuses.
-- No continuous GPS trail: at most one overwriteable last-active position.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '1min';

ALTER TABLE feedback.survey_sessions
    ADD COLUMN IF NOT EXISTS tracking_state text NOT NULL DEFAULT 'idle',
    ADD COLUMN IF NOT EXISTS completion_status text NOT NULL DEFAULT 'partial',
    ADD COLUMN IF NOT EXISTS accumulated_active_seconds integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS finished_at timestamptz,
    ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_checked_stop_sequence integer,
    ADD COLUMN IF NOT EXISTS checked_stop_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_stop_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pending_sync_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_gps_accuracy_m double precision,
    ADD COLUMN IF NOT EXISTS last_lat double precision,
    ADD COLUMN IF NOT EXISTS last_lng double precision,
    ADD COLUMN IF NOT EXISTS last_gps_at timestamptz,
    ADD COLUMN IF NOT EXISTS client_sync_state text;

UPDATE feedback.survey_sessions
SET tracking_state = CASE WHEN status = 'active' THEN 'active' ELSE 'idle' END,
    last_activity_at = COALESCE(last_activity_at, updated_at, started_at)
WHERE TRUE;

ALTER TABLE feedback.survey_sessions
    DROP CONSTRAINT IF EXISTS survey_sessions_tracking_state_chk,
    DROP CONSTRAINT IF EXISTS survey_sessions_completion_status_chk,
    DROP CONSTRAINT IF EXISTS survey_sessions_active_seconds_chk,
    DROP CONSTRAINT IF EXISTS survey_sessions_checked_stop_count_chk,
    DROP CONSTRAINT IF EXISTS survey_sessions_total_stop_count_chk,
    DROP CONSTRAINT IF EXISTS survey_sessions_pending_sync_count_chk,
    DROP CONSTRAINT IF EXISTS survey_sessions_last_gps_coords_chk;

ALTER TABLE feedback.survey_sessions
    ADD CONSTRAINT survey_sessions_tracking_state_chk
        CHECK (tracking_state = ANY (ARRAY['idle'::text, 'active'::text])),
    ADD CONSTRAINT survey_sessions_completion_status_chk
        CHECK (completion_status = ANY (ARRAY['partial'::text, 'finished'::text])),
    ADD CONSTRAINT survey_sessions_active_seconds_chk
        CHECK (accumulated_active_seconds >= 0),
    ADD CONSTRAINT survey_sessions_checked_stop_count_chk
        CHECK (checked_stop_count >= 0),
    ADD CONSTRAINT survey_sessions_total_stop_count_chk
        CHECK (total_stop_count >= 0),
    ADD CONSTRAINT survey_sessions_pending_sync_count_chk
        CHECK (pending_sync_count >= 0),
    ADD CONSTRAINT survey_sessions_last_gps_coords_chk
        CHECK (
            (last_lat IS NULL AND last_lng IS NULL)
            OR (
                last_lat IS NOT NULL
                AND last_lng IS NOT NULL
                AND last_lat BETWEEN -90 AND 90
                AND last_lng BETWEEN -180 AND 180
            )
        );

COMMENT ON COLUMN feedback.survey_sessions.tracking_state IS
    'GPS tracking: active only while surveyor explicitly started; idle after stop/finish/abandon.';
COMMENT ON COLUMN feedback.survey_sessions.completion_status IS
    'Personal work status for this surveyor session+variant: partial or finished. Independent of transport data.';
COMMENT ON COLUMN feedback.survey_sessions.accumulated_active_seconds IS
    'Sum of active tracking intervals. Client-owned; server stores latest sync.';
COMMENT ON COLUMN feedback.survey_sessions.last_lat IS
    'Single overwriteable last-active position. Not a trail.';
COMMENT ON COLUMN feedback.survey_sessions.checked_stop_count IS
    'Aggregate confirmed-correct stops only. Individual correct stops are never report rows.';

CREATE TABLE IF NOT EXISTS feedback.survey_session_events (
    id                 bigserial    PRIMARY KEY,
    survey_session_id  bigint       NOT NULL,
    event_type         text         NOT NULL,
    occurred_at        timestamptz  NOT NULL,
    client_event_id    uuid,
    created_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT survey_session_events_session_fkey
        FOREIGN KEY (survey_session_id)
        REFERENCES feedback.survey_sessions (id)
        ON DELETE CASCADE,
    CONSTRAINT survey_session_events_type_chk
        CHECK (event_type = ANY (ARRAY[
            'START'::text,
            'STOP'::text,
            'FINISH'::text,
            'REOPEN'::text
        ]))
);

CREATE UNIQUE INDEX IF NOT EXISTS survey_session_events_client_event_id_uidx
    ON feedback.survey_session_events (survey_session_id, client_event_id)
    WHERE client_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS survey_session_events_session_occurred_idx
    ON feedback.survey_session_events (survey_session_id, occurred_at DESC);

COMMENT ON TABLE feedback.survey_session_events IS
    'Minimal append-only lifecycle audit for START/STOP/FINISH/REOPEN. No GPS or stop-selection stream.';

ALTER TABLE feedback.survey_session_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE feedback.survey_session_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE feedback.survey_session_events_id_seq FROM PUBLIC, anon, authenticated;

RESET lock_timeout;
RESET statement_timeout;

COMMIT;
