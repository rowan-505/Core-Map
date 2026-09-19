-- =============================================================================
-- Rollback: 20260917080000_poi_category_ranking_group.sql
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

DROP INDEX IF EXISTS ref.ref_poi_categories_ranking_group_idx;

ALTER TABLE ref.ref_poi_categories
    DROP CONSTRAINT IF EXISTS ref_poi_categories_ranking_group_chk;

ALTER TABLE ref.ref_poi_categories
    DROP COLUMN IF EXISTS ranking_group;

COMMIT;
