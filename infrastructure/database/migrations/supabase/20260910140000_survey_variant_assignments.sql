-- Minimal surveyor route-variant assignments for field work queues.
-- Does not touch transport tables or copy completion state.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '1min';

CREATE TABLE IF NOT EXISTS feedback.survey_variant_assignments (
    id                   bigserial    PRIMARY KEY,
    public_id            uuid         NOT NULL DEFAULT gen_random_uuid(),
    surveyor_user_id     bigint       NOT NULL,
    route_variant_id     bigint       NOT NULL,
    assigned_by_user_id  bigint       NOT NULL,
    assigned_date        date         NOT NULL,
    due_date             date,
    status               text         NOT NULL DEFAULT 'active',
    cancelled_at         timestamptz,
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT survey_variant_assignments_public_id_key UNIQUE (public_id),
    CONSTRAINT survey_variant_assignments_surveyor_user_id_fkey
        FOREIGN KEY (surveyor_user_id) REFERENCES app_auth.auth_users (id) ON DELETE RESTRICT,
    CONSTRAINT survey_variant_assignments_assigned_by_user_id_fkey
        FOREIGN KEY (assigned_by_user_id) REFERENCES app_auth.auth_users (id) ON DELETE RESTRICT,
    CONSTRAINT survey_variant_assignments_route_variant_id_fkey
        FOREIGN KEY (route_variant_id) REFERENCES transport.route_variants (id) ON DELETE RESTRICT,
    CONSTRAINT survey_variant_assignments_status_chk
        CHECK (status = ANY (ARRAY['active'::text, 'cancelled'::text])),
    CONSTRAINT survey_variant_assignments_cancel_chk
        CHECK (
            (status = 'active' AND cancelled_at IS NULL)
            OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
        ),
    CONSTRAINT survey_variant_assignments_due_date_chk
        CHECK (due_date IS NULL OR due_date >= assigned_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS survey_variant_assignments_active_user_variant_key
    ON feedback.survey_variant_assignments (surveyor_user_id, route_variant_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS survey_variant_assignments_surveyor_status_idx
    ON feedback.survey_variant_assignments (surveyor_user_id, status, assigned_date DESC);

CREATE INDEX IF NOT EXISTS survey_variant_assignments_variant_idx
    ON feedback.survey_variant_assignments (route_variant_id);

COMMENT ON TABLE feedback.survey_variant_assignments IS
    'Manager-assigned route_variant work items for surveyors. D0/D1 are independent. Completion stays in survey_variant_completions.';

ALTER TABLE feedback.survey_variant_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE feedback.survey_variant_assignments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE feedback.survey_variant_assignments_id_seq FROM PUBLIC, anon, authenticated;

RESET lock_timeout;
RESET statement_timeout;

COMMIT;
