-- Rollback Phase 2 tourism taxonomy / ranking inputs (destructive to new columns).
-- Prefer forward-only in production.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE tourism.place_profiles
    ADD COLUMN IF NOT EXISTS tourism_type text;

UPDATE tourism.place_profiles AS pf
SET tourism_type = tt.code
FROM ref.ref_tourism_types AS tt
WHERE pf.tourism_type_id = tt.id
  AND (pf.tourism_type IS NULL OR btrim(pf.tourism_type) = '');

UPDATE tourism.place_profiles
SET tourism_type = 'other'
WHERE tourism_type IS NULL OR btrim(tourism_type) = '';

ALTER TABLE tourism.place_profiles
    ALTER COLUMN tourism_type SET NOT NULL;

ALTER TABLE tourism.place_profiles
    DROP CONSTRAINT IF EXISTS place_profiles_tourism_type_id_fkey;
ALTER TABLE tourism.place_profiles
    DROP CONSTRAINT IF EXISTS place_profiles_editorial_score_chk;
ALTER TABLE tourism.place_profiles
    DROP CONSTRAINT IF EXISTS place_profiles_manual_boost_chk;
ALTER TABLE tourism.place_profiles
    DROP CONSTRAINT IF EXISTS place_profiles_season_mode_chk;
ALTER TABLE tourism.place_profiles
    DROP CONSTRAINT IF EXISTS place_profiles_season_start_month_chk;
ALTER TABLE tourism.place_profiles
    DROP CONSTRAINT IF EXISTS place_profiles_season_end_month_chk;
ALTER TABLE tourism.place_profiles
    DROP CONSTRAINT IF EXISTS place_profiles_season_months_consistency_chk;

DROP INDEX IF EXISTS tourism.place_profiles_tourism_type_id_idx;

ALTER TABLE tourism.place_profiles
    DROP COLUMN IF EXISTS tourism_type_id,
    DROP COLUMN IF EXISTS editorial_score,
    DROP COLUMN IF EXISTS manual_boost,
    DROP COLUMN IF EXISTS season_mode,
    DROP COLUMN IF EXISTS season_start_month,
    DROP COLUMN IF EXISTS season_end_month;

ALTER TABLE tourism.place_profiles
    DROP CONSTRAINT IF EXISTS place_profiles_tourism_type_chk;

ALTER TABLE tourism.place_profiles
    ADD CONSTRAINT place_profiles_tourism_type_chk
    CHECK (char_length(btrim(tourism_type)) BETWEEN 1 AND 64);

CREATE INDEX IF NOT EXISTS place_profiles_tourism_type_idx
    ON tourism.place_profiles (tourism_type);

DROP TABLE IF EXISTS ref.ref_tourism_types;

RESET lock_timeout;
RESET statement_timeout;

COMMIT;
