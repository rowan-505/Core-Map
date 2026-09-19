-- Verification for community universal place reviews move.
-- Expected after apply: tables in community; tourism review tables gone; IDs preserved.

SELECT
    to_regclass('community.place_reviews') IS NOT NULL AS community_reviews,
    to_regclass('community.place_rating_summaries') IS NOT NULL AS community_summaries,
    to_regclass('community.review_moderation_events') IS NOT NULL AS community_events,
    to_regclass('tourism.place_reviews') IS NULL AS tourism_reviews_gone,
    to_regclass('tourism.place_rating_summaries') IS NULL AS tourism_summaries_gone,
    to_regclass('tourism.review_moderation_events') IS NULL AS tourism_events_gone,
    to_regclass('tourism.place_profiles') IS NOT NULL AS tourism_profiles_remain;

SELECT id, public_id::text, place_id, user_id, status
FROM community.place_reviews
ORDER BY id;

SELECT id, review_id, from_status, to_status
FROM community.review_moderation_events
ORDER BY id;

SELECT
    has_table_privilege('anon', 'community.place_reviews', 'SELECT') AS anon_reviews_select,
    has_table_privilege('authenticated', 'community.place_reviews', 'SELECT') AS authenticated_reviews_select;
