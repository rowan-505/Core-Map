-- =============================================================================
-- 20260917023446_community_universal_place_reviews.sql
-- -----------------------------------------------------------------------------
-- Move place reviews from tourism schema to community schema (universal POI
-- reviews). Data-preserving: ALTER TABLE SET SCHEMA — keeps row IDs, public_ids,
-- timestamps, indexes, constraints, sequences, and RLS flags.
--
-- tourism.place_profiles stays in tourism (tourism overlay only).
--
-- Safe: does not DROP/TRUNCATE review tables; does not recreate rows.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE SCHEMA IF NOT EXISTS community;

-- ----------------------------------------------------------------------------
-- 1. Drop triggers that call tourism-owned review functions (recreated below)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS place_reviews_before_write ON tourism.place_reviews;
DROP TRIGGER IF EXISTS place_reviews_refresh_summary ON tourism.place_reviews;
DROP TRIGGER IF EXISTS review_moderation_events_append_only ON tourism.review_moderation_events;

-- ----------------------------------------------------------------------------
-- 2. Move tables (indexes, constraints, sequences, RLS move with them)
-- ----------------------------------------------------------------------------
ALTER TABLE tourism.place_reviews SET SCHEMA community;
ALTER TABLE tourism.place_rating_summaries SET SCHEMA community;
ALTER TABLE tourism.review_moderation_events SET SCHEMA community;

COMMENT ON TABLE community.place_reviews IS
    'Universal user place reviews (1–5) for any public core.core_places row. Public reads and summaries use status = published only.';

COMMENT ON TABLE community.review_moderation_events IS
    'Append-only status transition history for community place reviews.';

COMMENT ON TABLE community.place_rating_summaries IS
    'Aggregate published review count and average only. Recompute from published rows; never store bayesian_score or reviewScore.';

-- ----------------------------------------------------------------------------
-- 3. Community-owned review functions (bodies reference community.*)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION community.place_reviews_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, extensions, community, core, app_auth
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

CREATE OR REPLACE FUNCTION community.refresh_place_rating_summary(p_place_id bigint)
RETURNS void
LANGUAGE plpgsql
SET search_path TO pg_catalog, extensions, community, core, app_auth
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
    FROM community.place_reviews
    WHERE place_id = p_place_id
      AND status = 'published';

    IF v_count = 0 THEN
        INSERT INTO community.place_rating_summaries AS s (
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
        INSERT INTO community.place_rating_summaries AS s (
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

COMMENT ON FUNCTION community.refresh_place_rating_summary(bigint) IS
    'Recompute published_review_count and average_rating for one place. No bayesian or reviewScore storage.';

CREATE OR REPLACE FUNCTION community.place_reviews_refresh_summary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, extensions, community, core, app_auth
AS $$
DECLARE
    v_place_id bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_place_id := OLD.place_id;
        PERFORM community.refresh_place_rating_summary(v_place_id);
        RETURN OLD;
    END IF;

    PERFORM community.refresh_place_rating_summary(NEW.place_id);

    IF TG_OP = 'UPDATE' AND OLD.place_id IS DISTINCT FROM NEW.place_id THEN
        PERFORM community.refresh_place_rating_summary(OLD.place_id);
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION community.reject_review_moderation_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, extensions, community, core, app_auth
AS $$
BEGIN
    RAISE EXCEPTION 'community.review_moderation_events is append-only'
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Recreate triggers on community tables
-- ----------------------------------------------------------------------------
CREATE TRIGGER place_reviews_before_write
    BEFORE INSERT OR UPDATE ON community.place_reviews
    FOR EACH ROW
    EXECUTE FUNCTION community.place_reviews_before_write();

CREATE TRIGGER place_reviews_refresh_summary
    AFTER INSERT OR UPDATE OR DELETE ON community.place_reviews
    FOR EACH ROW
    EXECUTE FUNCTION community.place_reviews_refresh_summary();

CREATE TRIGGER review_moderation_events_append_only
    BEFORE UPDATE OR DELETE ON community.review_moderation_events
    FOR EACH ROW
    EXECUTE FUNCTION community.reject_review_moderation_event_mutation();

-- ----------------------------------------------------------------------------
-- 5. Drop obsolete tourism review functions (profiles keep set_updated_at)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS tourism.place_reviews_before_write();
DROP FUNCTION IF EXISTS tourism.place_reviews_refresh_summary();
DROP FUNCTION IF EXISTS tourism.refresh_place_rating_summary(bigint);
DROP FUNCTION IF EXISTS tourism.reject_moderation_event_mutation();

-- ----------------------------------------------------------------------------
-- 6. Privilege lock (API / privileged role only) — do not weaken
-- ----------------------------------------------------------------------------
ALTER TABLE community.place_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.place_rating_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.review_moderation_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA community FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA community FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA community FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA community FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA community
    REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA community
    REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA community
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

RESET lock_timeout;
RESET statement_timeout;

COMMIT;
