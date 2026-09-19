-- =============================================================================
-- 20260917024448_tourism_taxonomy_and_ranking_inputs.sql
-- -----------------------------------------------------------------------------
-- Phase 2: normalize tourism type taxonomy + add Tourism Ranking V1 input fields.
-- Does NOT implement ranking score calculations.
--
-- 1) ref.ref_tourism_types (V1 flat taxonomy)
-- 2) tourism.place_profiles.tourism_type (text) -> tourism_type_id FK
-- 3) editorial_score, manual_boost, season_mode, season months
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

-- ----------------------------------------------------------------------------
-- 1. Tourism type reference
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ref.ref_tourism_types (
    id           bigserial PRIMARY KEY,
    code         text        NOT NULL,
    name_en      text        NOT NULL,
    name_mm      text,
    description  text,
    sort_order   integer     NOT NULL DEFAULT 0,
    is_active    boolean     NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ref_tourism_types_code_key UNIQUE (code),
    CONSTRAINT ref_tourism_types_code_chk
        CHECK (code = lower(btrim(code)) AND code ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT ref_tourism_types_name_en_chk
        CHECK (char_length(btrim(name_en)) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS ref_tourism_types_active_sort_idx
    ON ref.ref_tourism_types (is_active, sort_order, id);

COMMENT ON TABLE ref.ref_tourism_types IS
    'V1 tourism place type taxonomy for tourism.place_profiles.tourism_type_id.';

INSERT INTO ref.ref_tourism_types (code, name_en, name_mm, description, sort_order, is_active)
VALUES
    ('attraction', 'Attraction', 'အလည်အပတ်နေရာ', 'General tourist attraction', 10, true),
    ('religious', 'Religious', 'ဘာသာရေး', 'Pagoda, monastery, temple, shrine', 20, true),
    ('historical', 'Historical', 'သမိုင်းဝင်', 'Historical site or heritage place', 30, true),
    ('cultural', 'Cultural', 'ယဉ်ကျေးမှု', 'Cultural site or experience', 40, true),
    ('nature', 'Nature', 'သဘာဝ', 'Nature area (non-specific)', 50, true),
    ('museum', 'Museum', 'ပြတိုက်', 'Museum or exhibition', 60, true),
    ('viewpoint', 'Viewpoint', 'မြင်ကွင်းကောင်းရာ', 'Scenic viewpoint', 70, true),
    ('beach', 'Beach', 'ကမ်းခြေ', 'Beach', 80, true),
    ('waterfall', 'Waterfall', 'ရေတံခွန်', 'Waterfall', 90, true),
    ('park', 'Park', 'ဥယျာဉ်', 'Park or garden', 100, true),
    ('market', 'Market', 'ဈေး', 'Market', 110, true),
    ('recreation', 'Recreation', 'အားကစား/ပျော်ပါးရေး', 'Recreation or leisure', 120, true),
    ('other', 'Other', 'အခြား', 'Unclassified or other tourism type', 999, true)
ON CONFLICT (code) DO UPDATE
SET
    name_en = EXCLUDED.name_en,
    name_mm = EXCLUDED.name_mm,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = now();

-- ----------------------------------------------------------------------------
-- 2. Add tourism_type_id + ranking input columns (additive first)
-- ----------------------------------------------------------------------------
ALTER TABLE tourism.place_profiles
    ADD COLUMN IF NOT EXISTS tourism_type_id bigint,
    ADD COLUMN IF NOT EXISTS editorial_score integer NOT NULL DEFAULT 50,
    ADD COLUMN IF NOT EXISTS manual_boost integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS season_mode text NOT NULL DEFAULT 'all_year',
    ADD COLUMN IF NOT EXISTS season_start_month integer,
    ADD COLUMN IF NOT EXISTS season_end_month integer;

-- Map free-text tourism_type -> tourism_type_id when the old column still exists.
DO $$
DECLARE
    has_text_col boolean;
    unresolved_count integer;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'tourism'
          AND table_name = 'place_profiles'
          AND column_name = 'tourism_type'
    ) INTO has_text_col;

    IF has_text_col THEN
        -- Normalize common synonyms to V1 codes; unknown -> other.
        UPDATE tourism.place_profiles AS pf
        SET tourism_type_id = tt.id
        FROM ref.ref_tourism_types AS tt
        WHERE pf.tourism_type_id IS NULL
          AND tt.code = CASE
              WHEN lower(btrim(pf.tourism_type)) IN (
                  'attraction', 'tourist_attraction', 'sightseeing'
              ) THEN 'attraction'
              WHEN lower(btrim(pf.tourism_type)) IN (
                  'religious', 'pagoda', 'monastery', 'temple', 'shrine', 'church', 'mosque'
              ) THEN 'religious'
              WHEN lower(btrim(pf.tourism_type)) IN (
                  'historical', 'historic', 'heritage', 'history'
              ) THEN 'historical'
              WHEN lower(btrim(pf.tourism_type)) IN (
                  'cultural', 'culture'
              ) THEN 'cultural'
              WHEN lower(btrim(pf.tourism_type)) IN (
                  'nature', 'natural', 'forest', 'lake'
              ) THEN 'nature'
              WHEN lower(btrim(pf.tourism_type)) IN (
                  'museum', 'gallery'
              ) THEN 'museum'
              WHEN lower(btrim(pf.tourism_type)) IN (
                  'viewpoint', 'view_point', 'scenic_viewpoint', 'lookout'
              ) THEN 'viewpoint'
              WHEN lower(btrim(pf.tourism_type)) IN (
                  'beach', 'seaside'
              ) THEN 'beach'
              WHEN lower(btrim(pf.tourism_type)) IN (
                  'waterfall', 'falls'
              ) THEN 'waterfall'
              WHEN lower(btrim(pf.tourism_type)) IN (
                  'park', 'garden', 'public_park'
              ) THEN 'park'
              WHEN lower(btrim(pf.tourism_type)) IN (
                  'market', 'bazaar'
              ) THEN 'market'
              WHEN lower(btrim(pf.tourism_type)) IN (
                  'recreation', 'entertainment', 'leisure', 'sports'
              ) THEN 'recreation'
              WHEN lower(btrim(pf.tourism_type)) IN (
                  'other', 'unknown', 'misc', 'miscellaneous',
                  'hotel', 'restaurant', 'cafe', 'coffee', 'bar'
              ) THEN 'other'
              WHEN EXISTS (
                  SELECT 1 FROM ref.ref_tourism_types x
                  WHERE x.code = lower(btrim(pf.tourism_type))
              ) THEN lower(btrim(pf.tourism_type))
              ELSE 'other'
          END;

        SELECT COUNT(*)::integer INTO unresolved_count
        FROM tourism.place_profiles
        WHERE tourism_type_id IS NULL;

        IF unresolved_count > 0 THEN
            RAISE EXCEPTION
                'tourism.place_profiles: % row(s) still missing tourism_type_id after mapping',
                unresolved_count;
        END IF;

        -- Report any original values that landed on other via fallback (informational).
        RAISE NOTICE 'tourism_type mapping complete; profiles with non-exact codes mapped to synonyms/other where needed';
    END IF;
END $$;

-- If table was empty / column already migrated, still ensure NOT NULL by defaulting to other.
UPDATE tourism.place_profiles
SET tourism_type_id = (SELECT id FROM ref.ref_tourism_types WHERE code = 'other' LIMIT 1)
WHERE tourism_type_id IS NULL;

ALTER TABLE tourism.place_profiles
    ALTER COLUMN tourism_type_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'place_profiles_tourism_type_id_fkey'
          AND conrelid = 'tourism.place_profiles'::regclass
    ) THEN
        ALTER TABLE tourism.place_profiles
            ADD CONSTRAINT place_profiles_tourism_type_id_fkey
            FOREIGN KEY (tourism_type_id) REFERENCES ref.ref_tourism_types (id)
            ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS place_profiles_tourism_type_id_idx
    ON tourism.place_profiles (tourism_type_id);

-- Drop free-text tourism_type once FK is populated.
ALTER TABLE tourism.place_profiles
    DROP CONSTRAINT IF EXISTS place_profiles_tourism_type_chk;

DROP INDEX IF EXISTS tourism.place_profiles_tourism_type_idx;

ALTER TABLE tourism.place_profiles
    DROP COLUMN IF EXISTS tourism_type;

-- ----------------------------------------------------------------------------
-- 3. Ranking input constraints
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'place_profiles_editorial_score_chk'
          AND conrelid = 'tourism.place_profiles'::regclass
    ) THEN
        ALTER TABLE tourism.place_profiles
            ADD CONSTRAINT place_profiles_editorial_score_chk
            CHECK (editorial_score BETWEEN 0 AND 100);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'place_profiles_manual_boost_chk'
          AND conrelid = 'tourism.place_profiles'::regclass
    ) THEN
        ALTER TABLE tourism.place_profiles
            ADD CONSTRAINT place_profiles_manual_boost_chk
            CHECK (manual_boost BETWEEN -10 AND 10);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'place_profiles_season_mode_chk'
          AND conrelid = 'tourism.place_profiles'::regclass
    ) THEN
        ALTER TABLE tourism.place_profiles
            ADD CONSTRAINT place_profiles_season_mode_chk
            CHECK (season_mode = ANY (ARRAY[
                'all_year'::text,
                'best_months'::text,
                'poor_months'::text,
                'temporarily_closed'::text
            ]));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'place_profiles_season_start_month_chk'
          AND conrelid = 'tourism.place_profiles'::regclass
    ) THEN
        ALTER TABLE tourism.place_profiles
            ADD CONSTRAINT place_profiles_season_start_month_chk
            CHECK (season_start_month IS NULL OR season_start_month BETWEEN 1 AND 12);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'place_profiles_season_end_month_chk'
          AND conrelid = 'tourism.place_profiles'::regclass
    ) THEN
        ALTER TABLE tourism.place_profiles
            ADD CONSTRAINT place_profiles_season_end_month_chk
            CHECK (season_end_month IS NULL OR season_end_month BETWEEN 1 AND 12);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'place_profiles_season_months_consistency_chk'
          AND conrelid = 'tourism.place_profiles'::regclass
    ) THEN
        ALTER TABLE tourism.place_profiles
            ADD CONSTRAINT place_profiles_season_months_consistency_chk
            CHECK (
                season_mode IN ('all_year', 'temporarily_closed')
                OR (season_start_month IS NOT NULL AND season_end_month IS NOT NULL)
                OR (season_start_month IS NULL AND season_end_month IS NULL)
            );
    END IF;
END $$;

COMMENT ON COLUMN tourism.place_profiles.tourism_type_id IS
    'FK to ref.ref_tourism_types.id (V1 taxonomy).';
COMMENT ON COLUMN tourism.place_profiles.editorial_score IS
    'Admin editorial quality 0–100. UI levels map to fixed values (20/35/50/65/80/95). Not a computed ranking score.';
COMMENT ON COLUMN tourism.place_profiles.manual_boost IS
    'Admin manual boost -10..10 for Ranking V1 inputs. Not applied until ranking is implemented.';
COMMENT ON COLUMN tourism.place_profiles.season_mode IS
    'Seasonality mode: all_year | best_months | poor_months | temporarily_closed.';

RESET lock_timeout;
RESET statement_timeout;

COMMIT;
