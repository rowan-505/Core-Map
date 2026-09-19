-- Verify tourism reviews / ranking foundation (20260917030000).
-- Expect: tourism schema tables, one-active-review index, append-only events,
-- published-only summary helpers, report-type seeds, no core place mutation.

SELECT
    EXISTS (
        SELECT 1 FROM information_schema.schemata WHERE schema_name = 'tourism'
    ) AS has_tourism_schema,
    EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'tourism' AND table_name = 'place_profiles'
    ) AS has_place_profiles,
    EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'tourism' AND table_name = 'place_reviews'
    ) AS has_place_reviews,
    EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'tourism' AND table_name = 'review_moderation_events'
    ) AS has_review_moderation_events,
    EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'tourism' AND table_name = 'place_rating_summaries'
    ) AS has_place_rating_summaries,
    EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'tourism'
          AND indexname = 'place_reviews_one_active_per_user_place_uidx'
    ) AS has_one_active_review_uidx,
    EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'tourism'
          AND c.relname = 'review_moderation_events'
          AND t.tgname = 'review_moderation_events_append_only'
          AND NOT t.tgisinternal
    ) AS has_append_only_trigger,
    EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'tourism'
          AND p.proname = 'refresh_place_rating_summary'
    ) AS has_summary_refresh_fn,
    EXISTS (
        SELECT 1 FROM ref.ref_report_types WHERE code = 'tourism_incorrect_type'
    ) AS has_tourism_report_type,
    (
        SELECT COUNT(*)::int FROM ref.ref_report_types WHERE code LIKE 'tourism_%'
    ) AS tourism_report_type_count;

SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'tourism.place_reviews'::regclass
  AND contype = 'f'
ORDER BY conname;

SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'tourism.place_profiles'::regclass
  AND contype = 'f'
ORDER BY conname;

SELECT code
FROM ref.ref_report_types
WHERE code LIKE 'tourism_%'
ORDER BY code;

-- Hardening (20260917050000): pinned search_path + actor FK indexes + client lock.
SELECT
    p.proname,
    EXISTS (
        SELECT 1
        FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) setting
        WHERE setting LIKE 'search_path=%'
    ) AS has_pinned_search_path
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'tourism'
ORDER BY p.proname;

SELECT indexname, schemaname
FROM pg_indexes
WHERE (schemaname = 'tourism' AND indexname IN (
          'place_profiles_created_by_idx',
          'place_profiles_updated_by_idx',
          'place_reviews_one_active_per_user_place_uidx',
          'place_rating_summaries_ranking_idx'
      ))
   OR (schemaname = 'core' AND indexname = 'core_places_point_geom_gix')
ORDER BY schemaname, indexname;

SELECT
    has_schema_privilege('anon', 'tourism', 'USAGE') AS anon_tourism_usage,
    has_schema_privilege('authenticated', 'tourism', 'USAGE') AS authenticated_tourism_usage,
    has_table_privilege('anon', 'tourism.place_reviews', 'SELECT') AS anon_reviews_select,
    has_table_privilege('authenticated', 'tourism.place_reviews', 'SELECT') AS authenticated_reviews_select;
