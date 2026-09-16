-- Personal surveyor completion marks per route variant.
-- Does not touch transport tables, session lifecycle, or report statuses.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '1min';

CREATE TABLE IF NOT EXISTS feedback.survey_variant_completions (
    id                 bigserial    PRIMARY KEY,
    created_by         bigint       NOT NULL,
    route_variant_id   bigint       NOT NULL,
    is_finished        boolean      NOT NULL DEFAULT false,
    finished_at        timestamptz,
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    created_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT survey_variant_completions_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES app_auth.auth_users (id) ON DELETE RESTRICT,
    CONSTRAINT survey_variant_completions_route_variant_id_fkey
        FOREIGN KEY (route_variant_id) REFERENCES transport.route_variants (id) ON DELETE RESTRICT,
    CONSTRAINT survey_variant_completions_finished_at_chk
        CHECK (
            (is_finished = false AND finished_at IS NULL)
            OR (is_finished = true AND finished_at IS NOT NULL)
        ),
    CONSTRAINT survey_variant_completions_user_variant_key
        UNIQUE (created_by, route_variant_id)
);

CREATE INDEX IF NOT EXISTS survey_variant_completions_created_by_idx
    ON feedback.survey_variant_completions (created_by);

CREATE INDEX IF NOT EXISTS survey_variant_completions_variant_idx
    ON feedback.survey_variant_completions (route_variant_id);

COMMENT ON TABLE feedback.survey_variant_completions IS
    'Personal finished/not-finished marks per surveyor and route_variant. Not canonical transport data.';

ALTER TABLE feedback.survey_variant_completions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE feedback.survey_variant_completions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE feedback.survey_variant_completions_id_seq FROM PUBLIC, anon, authenticated;

RESET lock_timeout;
RESET statement_timeout;

COMMIT;
