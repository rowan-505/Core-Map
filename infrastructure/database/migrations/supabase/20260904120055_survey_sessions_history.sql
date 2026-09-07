-- Minimal private survey-session history for field-survey reports.
-- Stores session lifecycle only; GPS trails and duplicated route data stay out.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '1min';

-- Field API lookups use transport public IDs as stable external identifiers.
-- The previous production schema has no indexes or uniqueness enforcement on these columns.
ALTER TABLE transport.routes
    ADD CONSTRAINT routes_public_id_key UNIQUE (public_id);

ALTER TABLE transport.route_variants
    ADD CONSTRAINT route_variants_public_id_key UNIQUE (public_id);

-- Existing media remains readable. New field uploads always populate this value.
ALTER TABLE media.assets
    ADD COLUMN checksum_sha256 text;

ALTER TABLE media.assets
    ADD CONSTRAINT media_assets_checksum_sha256_chk
    CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN media.assets.checksum_sha256 IS
    'Expected lowercase SHA-256 supplied by the client and verified against private object metadata before ready status.';

CREATE TABLE feedback.survey_sessions (
    id                 bigserial    PRIMARY KEY,
    public_id          uuid         NOT NULL DEFAULT gen_random_uuid(),
    client_session_id  uuid         NOT NULL,
    created_by         bigint       NOT NULL,
    route_variant_id   bigint       NOT NULL,
    snapshot_revision  text         NOT NULL,
    started_at         timestamptz  NOT NULL,
    ended_at           timestamptz,
    status             text         NOT NULL,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT survey_sessions_public_id_key UNIQUE (public_id),
    CONSTRAINT survey_sessions_client_session_id_key UNIQUE (client_session_id),
    CONSTRAINT survey_sessions_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES app_auth.auth_users (id) ON DELETE RESTRICT,
    CONSTRAINT survey_sessions_route_variant_id_fkey
        FOREIGN KEY (route_variant_id) REFERENCES transport.route_variants (id) ON DELETE RESTRICT,
    CONSTRAINT survey_sessions_status_chk
        CHECK (status = ANY (ARRAY['active'::text, 'completed'::text, 'abandoned'::text])),
    CONSTRAINT survey_sessions_ended_at_chk
        CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX survey_sessions_created_by_started_at_idx
    ON feedback.survey_sessions (created_by, started_at DESC);

CREATE INDEX survey_sessions_route_variant_id_idx
    ON feedback.survey_sessions (route_variant_id);

COMMENT ON TABLE feedback.survey_sessions IS
    'Private field-survey lifecycle history. Zero-report sessions are valid; continuous GPS points are not stored.';
COMMENT ON COLUMN feedback.survey_sessions.client_session_id IS
    'Client-generated idempotency key for one survey session.';
COMMENT ON COLUMN feedback.survey_sessions.snapshot_revision IS
    'Transport snapshot revision used by the surveyor; route geometry and stops remain canonical transport data.';

ALTER TABLE feedback.user_reports
    ADD COLUMN survey_session_id bigint;

ALTER TABLE feedback.user_reports
    ADD CONSTRAINT user_reports_survey_session_id_fkey
    FOREIGN KEY (survey_session_id)
    REFERENCES feedback.survey_sessions (id)
    ON DELETE SET NULL;

CREATE INDEX user_reports_survey_session_id_idx
    ON feedback.user_reports (survey_session_id);

COMMENT ON COLUMN feedback.user_reports.survey_session_id IS
    'Optional field-survey session that produced this report. Historical reports remain unlinked.';

ALTER TABLE feedback.survey_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE feedback.survey_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE feedback.survey_sessions_id_seq FROM PUBLIC, anon, authenticated;

RESET lock_timeout;
RESET statement_timeout;

COMMIT;
