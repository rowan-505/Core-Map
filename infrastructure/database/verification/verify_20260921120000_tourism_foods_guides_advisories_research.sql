-- Verify Phase 1 tourism foods / guides / advisories / research_candidates.

SELECT
    to_regclass('tourism.foods') IS NOT NULL AS has_foods,
    to_regclass('tourism.food_place_links') IS NOT NULL AS has_food_place_links,
    to_regclass('tourism.local_guides') IS NOT NULL AS has_local_guides,
    to_regclass('tourism.advisories') IS NOT NULL AS has_advisories,
    to_regclass('tourism.research_candidates') IS NOT NULL AS has_research_candidates;

SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'tourism.foods'::regclass
ORDER BY 1;

SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'tourism.food_place_links'::regclass
ORDER BY 1;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'tourism'
  AND tablename IN (
      'foods',
      'food_place_links',
      'local_guides',
      'advisories',
      'research_candidates'
  )
ORDER BY tablename, indexname;

-- Existing tourism tables must remain.
SELECT
    to_regclass('tourism.place_profiles') IS NOT NULL AS place_profiles_remain,
    to_regclass('tourism.activities') IS NOT NULL AS activities_remain,
    to_regclass('tourism.events') IS NOT NULL AS events_remain,
    to_regclass('tourism.event_occurrences') IS NOT NULL AS event_occurrences_remain,
    to_regclass('tourism.ranking_configs') IS NOT NULL AS ranking_configs_remain,
    to_regclass('tourism.place_candidate_ignores') IS NOT NULL AS place_candidate_ignores_remain;
