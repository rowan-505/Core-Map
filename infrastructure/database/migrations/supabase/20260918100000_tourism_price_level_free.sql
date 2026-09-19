-- =============================================================================
-- 20260918100000_tourism_price_level_free.sql
-- -----------------------------------------------------------------------------
-- Allow price_level = 0 for Free visitor cost.
-- NULL = Unknown, 0 = Free, 1–4 = $–$$$$.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE tourism.place_profiles
    DROP CONSTRAINT IF EXISTS place_profiles_price_level_chk;

ALTER TABLE tourism.place_profiles
    ADD CONSTRAINT place_profiles_price_level_chk
    CHECK (price_level IS NULL OR (price_level >= 0 AND price_level <= 4));

COMMENT ON COLUMN tourism.place_profiles.price_level IS
    'Visitor cost: NULL=unknown, 0=free, 1–4 = $–$$$$';

COMMIT;
