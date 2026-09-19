-- =============================================================================
-- 20260917030000_tourism_reviews_ranking_foundation.sql
-- -----------------------------------------------------------------------------
-- Tourism place profiles, user reviews, moderation history, and rating summaries.
--
-- Rules encoded here:
--   * One profile row per core place (place_id PK → core.core_places.id).
--   * Reviews FK to core places + app_auth.auth_users (no duplicate places).
--   * One non-deleted review per (place_id, user_id); deleted rows may be replaced.
--   * Summaries store only published_review_count + average_rating (no bayesian).
--   * Public visibility (enforced by API reads; documented for clients):
--       core.core_places.deleted_at IS NULL
--       AND core.core_places.is_public
--       AND tourism.place_profiles.is_public
--       AND review.status = 'published' (summaries count published only)
--
-- Access pattern (matches community / survey private schemas):
--   * RLS enabled with no anon/authenticated policies
--   * REVOKE from PUBLIC, anon, authenticated — Fastify/Prisma only
--
-- Safe: additive; does not modify core.core_places rows or create place duplicates.
-- Out of scope: review comments, helpful votes, reputation, auto points, booking, AI.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE SCHEMA IF NOT EXISTS tourism;

COMMENT ON SCHEMA tourism IS
    'Tourism profiles, place reviews, moderation events, and rating summaries. API-only access.';

-- ----------------------------------------------------------------------------
-- Helpers: updated_at + append-only guard
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tourism.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION tourism.reject_moderation_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'tourism.review_moderation_events is append-only'
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. place_profiles
-- ----------------------------------------------------------------------------
CREATE TABLE tourism.place_profiles (
    place_id           bigint       PRIMARY KEY,
    tourism_type       text         NOT NULL,
    short_description  text,
    price_level        integer,
    editor_pick        boolean      NOT NULL DEFAULT false,
    is_public          boolean      NOT NULL DEFAULT true,
    created_by         bigint,
    updated_by         bigint,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT place_profiles_place_id_fkey
        FOREIGN KEY (place_id) REFERENCES core.core_places (id) ON DELETE RESTRICT,
    CONSTRAINT place_profiles_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES app_auth.auth_users (id) ON DELETE SET NULL,
    CONSTRAINT place_profiles_updated_by_fkey
        FOREIGN KEY (updated_by) REFERENCES app_auth.auth_users (id) ON DELETE SET NULL,
    CONSTRAINT place_profiles_tourism_type_chk
        CHECK (char_length(btrim(tourism_type)) BETWEEN 1 AND 64),
    CONSTRAINT place_profiles_short_description_chk
        CHECK (short_description IS NULL OR char_length(short_description) <= 1000),
    CONSTRAINT place_profiles_price_level_chk
        CHECK (price_level IS NULL OR price_level BETWEEN 1 AND 4)
);

COMMENT ON TABLE tourism.place_profiles IS
    'Optional tourism overlay for an existing core place. Does not duplicate places.';
COMMENT ON COLUMN tourism.place_profiles.tourism_type IS
    'Tourism classification on the profile overlay (not a core_places column).';
COMMENT ON COLUMN tourism.place_profiles.is_public IS
    'Public listing requires is_public AND linked core place is_public with deleted_at IS NULL.';

CREATE INDEX place_profiles_tourism_type_idx
    ON tourism.place_profiles (tourism_type);

CREATE INDEX place_profiles_editor_pick_public_idx
    ON tourism.place_profiles (editor_pick, place_id)
    WHERE editor_pick = true AND is_public = true;

CREATE INDEX place_profiles_is_public_idx
    ON tourism.place_profiles (is_public)
    WHERE is_public = true;

CREATE INDEX place_profiles_created_at_idx
    ON tourism.place_profiles (created_at DESC);

CREATE TRIGGER place_profiles_set_updated_at
    BEFORE UPDATE ON tourism.place_profiles
    FOR EACH ROW
    EXECUTE FUNCTION tourism.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. place_reviews
-- ----------------------------------------------------------------------------
CREATE TABLE tourism.place_reviews (
    id                 bigserial    PRIMARY KEY,
    public_id          uuid         NOT NULL DEFAULT gen_random_uuid(),
    place_id           bigint       NOT NULL,
    user_id            bigint       NOT NULL,
    rating             integer      NOT NULL,
    title              text,
    body               text,
    status             text         NOT NULL DEFAULT 'pending',
    moderation_note    text,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    published_at       timestamptz,

    CONSTRAINT place_reviews_public_id_key UNIQUE (public_id),
    CONSTRAINT place_reviews_place_id_fkey
        FOREIGN KEY (place_id) REFERENCES core.core_places (id) ON DELETE RESTRICT,
    CONSTRAINT place_reviews_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES app_auth.auth_users (id) ON DELETE RESTRICT,
    CONSTRAINT place_reviews_rating_chk
        CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT place_reviews_title_chk
        CHECK (title IS NULL OR char_length(title) <= 200),
    CONSTRAINT place_reviews_body_chk
        CHECK (body IS NULL OR char_length(body) <= 5000),
    CONSTRAINT place_reviews_moderation_note_chk
        CHECK (moderation_note IS NULL OR char_length(moderation_note) <= 2000),
    CONSTRAINT place_reviews_status_chk
        CHECK (status = ANY (ARRAY[
            'pending'::text,
            'published'::text,
            'rejected'::text,
            'hidden'::text,
            'deleted'::text
        ])),
    CONSTRAINT place_reviews_published_at_chk
        CHECK (status <> 'published' OR published_at IS NOT NULL)
);

COMMENT ON TABLE tourism.place_reviews IS
    'User place reviews (1–5). Public reads and summaries use status = published only.';

-- Soft uniqueness: one non-deleted review per user+place; deleted may be replaced.
CREATE UNIQUE INDEX place_reviews_one_active_per_user_place_uidx
    ON tourism.place_reviews (place_id, user_id)
    WHERE status <> 'deleted';

CREATE INDEX place_reviews_place_id_idx
    ON tourism.place_reviews (place_id);

CREATE INDEX place_reviews_user_id_idx
    ON tourism.place_reviews (user_id);

CREATE INDEX place_reviews_status_idx
    ON tourism.place_reviews (status);

CREATE INDEX place_reviews_created_at_idx
    ON tourism.place_reviews (created_at DESC);

CREATE INDEX place_reviews_place_status_created_idx
    ON tourism.place_reviews (place_id, status, created_at DESC);

CREATE INDEX place_reviews_published_place_created_idx
    ON tourism.place_reviews (place_id, created_at DESC)
    WHERE status = 'published';

CREATE INDEX place_reviews_published_rating_idx
    ON tourism.place_reviews (place_id, rating)
    WHERE status = 'published';

CREATE OR REPLACE FUNCTION tourism.place_reviews_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();

    IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
        NEW.published_at := now();
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'published' AND NEW.status <> 'published' THEN
        -- Keep historical published_at for audit; do not null it.
        NULL;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER place_reviews_before_write
    BEFORE INSERT OR UPDATE ON tourism.place_reviews
    FOR EACH ROW
    EXECUTE FUNCTION tourism.place_reviews_before_write();

-- ----------------------------------------------------------------------------
-- 3. review_moderation_events (append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE tourism.review_moderation_events (
    id              bigserial    PRIMARY KEY,
    review_id       bigint       NOT NULL,
    actor_user_id   bigint,
    from_status     text         NOT NULL,
    to_status       text         NOT NULL,
    note            text,
    created_at      timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT review_moderation_events_review_id_fkey
        FOREIGN KEY (review_id) REFERENCES tourism.place_reviews (id) ON DELETE CASCADE,
    CONSTRAINT review_moderation_events_actor_user_id_fkey
        FOREIGN KEY (actor_user_id) REFERENCES app_auth.auth_users (id) ON DELETE SET NULL,
    CONSTRAINT review_moderation_events_from_status_chk
        CHECK (from_status = ANY (ARRAY[
            'pending'::text,
            'published'::text,
            'rejected'::text,
            'hidden'::text,
            'deleted'::text
        ])),
    CONSTRAINT review_moderation_events_to_status_chk
        CHECK (to_status = ANY (ARRAY[
            'pending'::text,
            'published'::text,
            'rejected'::text,
            'hidden'::text,
            'deleted'::text
        ])),
    CONSTRAINT review_moderation_events_note_chk
        CHECK (note IS NULL OR char_length(note) <= 2000)
);

COMMENT ON TABLE tourism.review_moderation_events IS
    'Append-only status transition history for tourism place reviews.';

CREATE INDEX review_moderation_events_review_created_idx
    ON tourism.review_moderation_events (review_id, created_at DESC);

CREATE INDEX review_moderation_events_actor_idx
    ON tourism.review_moderation_events (actor_user_id)
    WHERE actor_user_id IS NOT NULL;

CREATE INDEX review_moderation_events_created_at_idx
    ON tourism.review_moderation_events (created_at DESC);

CREATE TRIGGER review_moderation_events_append_only
    BEFORE UPDATE OR DELETE ON tourism.review_moderation_events
    FOR EACH ROW
    EXECUTE FUNCTION tourism.reject_moderation_event_mutation();

-- ----------------------------------------------------------------------------
-- 4. place_rating_summaries (aggregates only; no bayesian_score)
-- ----------------------------------------------------------------------------
CREATE TABLE tourism.place_rating_summaries (
    place_id                 bigint       PRIMARY KEY,
    published_review_count   integer      NOT NULL DEFAULT 0,
    average_rating           numeric(4, 2),
    updated_at               timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT place_rating_summaries_place_id_fkey
        FOREIGN KEY (place_id) REFERENCES core.core_places (id) ON DELETE RESTRICT,
    CONSTRAINT place_rating_summaries_count_chk
        CHECK (published_review_count >= 0),
    CONSTRAINT place_rating_summaries_average_chk
        CHECK (
            average_rating IS NULL
            OR (average_rating >= 1 AND average_rating <= 5)
        ),
    CONSTRAINT place_rating_summaries_count_average_consistency_chk
        CHECK (
            (published_review_count = 0 AND average_rating IS NULL)
            OR (published_review_count > 0 AND average_rating IS NOT NULL)
        )
);

COMMENT ON TABLE tourism.place_rating_summaries IS
    'Aggregate published review count and average only. Recompute average from published rows; never store bayesian_score.';

CREATE INDEX place_rating_summaries_ranking_idx
    ON tourism.place_rating_summaries (average_rating DESC NULLS LAST, published_review_count DESC, place_id);

CREATE INDEX place_rating_summaries_count_idx
    ON tourism.place_rating_summaries (published_review_count DESC, place_id)
    WHERE published_review_count > 0;

CREATE INDEX place_rating_summaries_updated_at_idx
    ON tourism.place_rating_summaries (updated_at DESC);

-- ----------------------------------------------------------------------------
-- Summary refresh (transaction-safe upsert)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tourism.refresh_place_rating_summary(p_place_id bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_count   integer;
    v_average numeric(4, 2);
BEGIN
    IF p_place_id IS NULL THEN
        RETURN;
    END IF;

    SELECT
        COUNT(*)::integer,
        ROUND(AVG(rating)::numeric, 2)
    INTO v_count, v_average
    FROM tourism.place_reviews
    WHERE place_id = p_place_id
      AND status = 'published';

    IF v_count = 0 THEN
        INSERT INTO tourism.place_rating_summaries AS s (
            place_id,
            published_review_count,
            average_rating,
            updated_at
        )
        VALUES (p_place_id, 0, NULL, now())
        ON CONFLICT (place_id) DO UPDATE
        SET published_review_count = 0,
            average_rating = NULL,
            updated_at = now();
    ELSE
        INSERT INTO tourism.place_rating_summaries AS s (
            place_id,
            published_review_count,
            average_rating,
            updated_at
        )
        VALUES (p_place_id, v_count, v_average, now())
        ON CONFLICT (place_id) DO UPDATE
        SET published_review_count = EXCLUDED.published_review_count,
            average_rating = EXCLUDED.average_rating,
            updated_at = now();
    END IF;
END;
$$;

COMMENT ON FUNCTION tourism.refresh_place_rating_summary(bigint) IS
    'Recompute published_review_count and average_rating for one place. No bayesian score.';

CREATE OR REPLACE FUNCTION tourism.place_reviews_refresh_summary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_place_id bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_place_id := OLD.place_id;
        PERFORM tourism.refresh_place_rating_summary(v_place_id);
        RETURN OLD;
    END IF;

    PERFORM tourism.refresh_place_rating_summary(NEW.place_id);

    IF TG_OP = 'UPDATE' AND OLD.place_id IS DISTINCT FROM NEW.place_id THEN
        PERFORM tourism.refresh_place_rating_summary(OLD.place_id);
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER place_reviews_refresh_summary
    AFTER INSERT OR UPDATE OR DELETE ON tourism.place_reviews
    FOR EACH ROW
    EXECUTE FUNCTION tourism.place_reviews_refresh_summary();

-- ----------------------------------------------------------------------------
-- RLS + privilege lock (API / privileged role only)
-- ----------------------------------------------------------------------------
ALTER TABLE tourism.place_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tourism.place_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE tourism.review_moderation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tourism.place_rating_summaries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA tourism FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA tourism FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tourism FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA tourism FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA tourism
    REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA tourism
    REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA tourism
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

RESET lock_timeout;
RESET statement_timeout;

COMMIT;
