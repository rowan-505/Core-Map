-- Rollback: move universal place reviews back to tourism schema.
-- Prefer forward-only in production; use only when intentionally reversing Phase 1.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

DROP TRIGGER IF EXISTS place_reviews_before_write ON community.place_reviews;
DROP TRIGGER IF EXISTS place_reviews_refresh_summary ON community.place_reviews;
DROP TRIGGER IF EXISTS review_moderation_events_append_only ON community.review_moderation_events;

ALTER TABLE community.place_reviews SET SCHEMA tourism;
ALTER TABLE community.place_rating_summaries SET SCHEMA tourism;
ALTER TABLE community.review_moderation_events SET SCHEMA tourism;

CREATE OR REPLACE FUNCTION tourism.place_reviews_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, extensions, tourism, core, app_auth
AS $$
BEGIN
    NEW.updated_at := now();
    IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
        NEW.published_at := now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION tourism.refresh_place_rating_summary(p_place_id bigint)
RETURNS void
LANGUAGE plpgsql
SET search_path TO pg_catalog, extensions, tourism, core, app_auth
AS $$
DECLARE
    v_count   integer;
    v_average numeric(4, 2);
BEGIN
    IF p_place_id IS NULL THEN
        RETURN;
    END IF;
    SELECT COUNT(*)::integer, ROUND(AVG(rating)::numeric, 2)
    INTO v_count, v_average
    FROM tourism.place_reviews
    WHERE place_id = p_place_id AND status = 'published';
    IF v_count = 0 THEN
        INSERT INTO tourism.place_rating_summaries AS s (place_id, published_review_count, average_rating, updated_at)
        VALUES (p_place_id, 0, NULL, now())
        ON CONFLICT (place_id) DO UPDATE
        SET published_review_count = 0, average_rating = NULL, updated_at = now();
    ELSE
        INSERT INTO tourism.place_rating_summaries AS s (place_id, published_review_count, average_rating, updated_at)
        VALUES (p_place_id, v_count, v_average, now())
        ON CONFLICT (place_id) DO UPDATE
        SET published_review_count = EXCLUDED.published_review_count,
            average_rating = EXCLUDED.average_rating,
            updated_at = now();
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION tourism.place_reviews_refresh_summary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, extensions, tourism, core, app_auth
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM tourism.refresh_place_rating_summary(OLD.place_id);
        RETURN OLD;
    END IF;
    PERFORM tourism.refresh_place_rating_summary(NEW.place_id);
    IF TG_OP = 'UPDATE' AND OLD.place_id IS DISTINCT FROM NEW.place_id THEN
        PERFORM tourism.refresh_place_rating_summary(OLD.place_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION tourism.reject_moderation_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, extensions, tourism, core, app_auth
AS $$
BEGIN
    RAISE EXCEPTION 'tourism.review_moderation_events is append-only'
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER place_reviews_before_write
    BEFORE INSERT OR UPDATE ON tourism.place_reviews
    FOR EACH ROW
    EXECUTE FUNCTION tourism.place_reviews_before_write();

CREATE TRIGGER place_reviews_refresh_summary
    AFTER INSERT OR UPDATE OR DELETE ON tourism.place_reviews
    FOR EACH ROW
    EXECUTE FUNCTION tourism.place_reviews_refresh_summary();

CREATE TRIGGER review_moderation_events_append_only
    BEFORE UPDATE OR DELETE ON tourism.review_moderation_events
    FOR EACH ROW
    EXECUTE FUNCTION tourism.reject_moderation_event_mutation();

DROP FUNCTION IF EXISTS community.place_reviews_before_write();
DROP FUNCTION IF EXISTS community.place_reviews_refresh_summary();
DROP FUNCTION IF EXISTS community.refresh_place_rating_summary(bigint);
DROP FUNCTION IF EXISTS community.reject_review_moderation_event_mutation();

RESET lock_timeout;
RESET statement_timeout;

COMMIT;
