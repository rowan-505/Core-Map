-- Rollback: 20260918100000_tourism_price_level_free.sql

BEGIN;

UPDATE tourism.place_profiles
SET price_level = NULL
WHERE price_level = 0;

ALTER TABLE tourism.place_profiles
    DROP CONSTRAINT IF EXISTS place_profiles_price_level_chk;

ALTER TABLE tourism.place_profiles
    ADD CONSTRAINT place_profiles_price_level_chk
    CHECK (price_level IS NULL OR (price_level >= 1 AND price_level <= 4));

COMMIT;
