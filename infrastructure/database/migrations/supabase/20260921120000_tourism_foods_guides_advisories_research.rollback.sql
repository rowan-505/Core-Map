-- =============================================================================
-- Rollback: 20260921120000_tourism_foods_guides_advisories_research.sql
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

DROP TABLE IF EXISTS tourism.research_candidates;
DROP TABLE IF EXISTS tourism.advisories;
DROP TABLE IF EXISTS tourism.local_guides;
DROP TABLE IF EXISTS tourism.food_place_links;
DROP TABLE IF EXISTS tourism.foods;

COMMIT;
