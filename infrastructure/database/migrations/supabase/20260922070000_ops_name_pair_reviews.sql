-- Name-pair review queue for bilingual MM/EN fill.
-- Simple fills write production names directly; important/uncertain cases land here.

CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS ops.name_pair_reviews (
    id                  bigserial PRIMARY KEY,
    public_id           uuid         NOT NULL DEFAULT gen_random_uuid(),
    entity_type         text         NOT NULL,
    entity_id           bigint       NOT NULL,
    entity_public_id    uuid,
    direction           text         NOT NULL,
    source_name         text         NOT NULL,
    proposed_mm         text,
    proposed_en         text,
    confidence          smallint     NOT NULL DEFAULT 50,
    reason              text         NOT NULL,
    status              text         NOT NULL DEFAULT 'pending',
    fill_run_id         text,
    reviewed_by         bigint
        REFERENCES app_auth.auth_users (id) ON DELETE SET NULL ON UPDATE CASCADE,
    reviewed_at         timestamptz,
    review_note         text,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT name_pair_reviews_public_id_key UNIQUE (public_id),
    CONSTRAINT name_pair_reviews_entity_type_chk
        CHECK (entity_type = ANY (ARRAY[
            'place'::text,
            'settlement'::text,
            'admin_area'::text,
            'street'::text,
            'building'::text,
            'transport_stop'::text,
            'transport_terminal'::text
        ])),
    CONSTRAINT name_pair_reviews_direction_chk
        CHECK (direction = ANY (ARRAY[
            'mm_to_en'::text,
            'en_to_mm'::text,
            'split_mixed'::text,
            'fix_false_pair'::text
        ])),
    CONSTRAINT name_pair_reviews_status_chk
        CHECK (status = ANY (ARRAY[
            'pending'::text,
            'approved'::text,
            'rejected'::text,
            'skipped'::text
        ])),
    CONSTRAINT name_pair_reviews_confidence_chk
        CHECK (confidence BETWEEN 0 AND 100),
    CONSTRAINT name_pair_reviews_source_name_chk
        CHECK (char_length(btrim(source_name)) BETWEEN 1 AND 500),
    CONSTRAINT name_pair_reviews_proposed_mm_chk
        CHECK (proposed_mm IS NULL OR char_length(btrim(proposed_mm)) BETWEEN 1 AND 500),
    CONSTRAINT name_pair_reviews_proposed_en_chk
        CHECK (proposed_en IS NULL OR char_length(btrim(proposed_en)) BETWEEN 1 AND 500),
    CONSTRAINT name_pair_reviews_reason_chk
        CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
    CONSTRAINT name_pair_reviews_fill_run_id_chk
        CHECK (fill_run_id IS NULL OR char_length(btrim(fill_run_id)) BETWEEN 1 AND 120),
    CONSTRAINT name_pair_reviews_review_note_chk
        CHECK (review_note IS NULL OR char_length(btrim(review_note)) BETWEEN 1 AND 1000),
    CONSTRAINT name_pair_reviews_proposal_present_chk
        CHECK (proposed_mm IS NOT NULL OR proposed_en IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS name_pair_reviews_pending_entity_direction_uidx
    ON ops.name_pair_reviews (entity_type, entity_id, direction)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS name_pair_reviews_status_entity_type_idx
    ON ops.name_pair_reviews (status, entity_type, created_at DESC);

CREATE INDEX IF NOT EXISTS name_pair_reviews_fill_run_id_idx
    ON ops.name_pair_reviews (fill_run_id)
    WHERE fill_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ops.name_pair_fill_runs (
    id              bigserial PRIMARY KEY,
    run_id          text         NOT NULL,
    dry_run         boolean      NOT NULL DEFAULT true,
    started_at      timestamptz  NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    summary         jsonb        NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT name_pair_fill_runs_run_id_key UNIQUE (run_id),
    CONSTRAINT name_pair_fill_runs_run_id_chk
        CHECK (char_length(btrim(run_id)) BETWEEN 1 AND 120)
);

CREATE OR REPLACE FUNCTION ops.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS name_pair_reviews_set_updated_at ON ops.name_pair_reviews;
CREATE TRIGGER name_pair_reviews_set_updated_at
    BEFORE UPDATE ON ops.name_pair_reviews
    FOR EACH ROW
    EXECUTE FUNCTION ops.set_updated_at();

ALTER TABLE ops.name_pair_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.name_pair_fill_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA ops FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA ops FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ops FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA ops TO postgres, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA ops TO postgres, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA ops TO postgres, service_role;

COMMENT ON TABLE ops.name_pair_reviews IS
    'Important/uncertain bilingual name proposals awaiting dashboard approve/reject. Simple fills write core name tables directly.';

COMMENT ON TABLE ops.name_pair_fill_runs IS
    'Batch log for name-pair-fill tool dry-run and apply runs.';
