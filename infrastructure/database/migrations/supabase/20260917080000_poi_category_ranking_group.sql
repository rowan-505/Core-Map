-- =============================================================================
-- 20260917080000_poi_category_ranking_group.sql
-- -----------------------------------------------------------------------------
-- Phase 5: Food & Drink Township Recommendations V1 — category ranking_group.
-- ranking_group decides ranking participation only; all places stay reviewable.
-- Seed by stable category code. Only food_drink is enabled in V1.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE ref.ref_poi_categories
    ADD COLUMN IF NOT EXISTS ranking_group text NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ref_poi_categories_ranking_group_chk'
          AND conrelid = 'ref.ref_poi_categories'::regclass
    ) THEN
        ALTER TABLE ref.ref_poi_categories
            ADD CONSTRAINT ref_poi_categories_ranking_group_chk
            CHECK (
                ranking_group IS NULL
                OR ranking_group = 'food_drink'
            );
    END IF;
END $$;

COMMENT ON COLUMN ref.ref_poi_categories.ranking_group IS
    'Optional ranking participation group. V1: food_drink only. NULL means not in any ranking.';

-- Seed only existing food-related codes inspected in Map Project:
-- food (parent), restaurant, cafe, teashop.
UPDATE ref.ref_poi_categories
SET ranking_group = 'food_drink'
WHERE code IN ('food', 'restaurant', 'cafe', 'teashop');

CREATE INDEX IF NOT EXISTS ref_poi_categories_ranking_group_idx
    ON ref.ref_poi_categories (ranking_group)
    WHERE ranking_group IS NOT NULL;

COMMIT;
