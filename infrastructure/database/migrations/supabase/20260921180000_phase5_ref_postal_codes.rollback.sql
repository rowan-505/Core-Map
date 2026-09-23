-- Rollback for 20260921180000_phase5_ref_postal_codes.sql
--
-- WARNING: Only drop the table when this Phase-5 migration created it on a
-- fresh environment. If production already had ref.ref_postal_codes from
-- 20260921150000, do NOT run the DROP — restore column names instead.
--
-- Safe rollback path A (rename mm → my if this migration renamed them):
--   See reports/admin-reconciliation-v2/phase5/05-rollback.sql
--
-- Destructive path B (fresh install only):

BEGIN;

-- Prefer non-destructive rename restore when legacy names are absent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='ref' AND table_name='ref_postal_codes' AND column_name='region_name_mm'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='ref' AND table_name='ref_postal_codes' AND column_name='region_name_my'
  ) THEN
    ALTER TABLE ref.ref_postal_codes RENAME COLUMN region_name_mm TO region_name_my;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='ref' AND table_name='ref_postal_codes' AND column_name='township_name_mm'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='ref' AND table_name='ref_postal_codes' AND column_name='township_name_my'
  ) THEN
    ALTER TABLE ref.ref_postal_codes RENAME COLUMN township_name_mm TO township_name_my;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='ref' AND table_name='ref_postal_codes' AND column_name='locality_name_mm'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='ref' AND table_name='ref_postal_codes' AND column_name='locality_name_my'
  ) THEN
    ALTER TABLE ref.ref_postal_codes RENAME COLUMN locality_name_mm TO locality_name_my;
  END IF;
END $$;

-- Restore legacy match_status check (Phase-1/2 values only).
ALTER TABLE ref.ref_postal_codes DROP CONSTRAINT IF EXISTS ref_postal_codes_match_status_chk;
ALTER TABLE ref.ref_postal_codes
  ADD CONSTRAINT ref_postal_codes_match_status_chk
  CHECK (match_status IN (
    'linked_local_area',
    'linked_township_only',
    'ambiguous',
    'unmatched',
    'malformed_rejected'
  ));

-- Uncomment ONLY on environments where this table did not exist before Phase 5:
-- DROP TABLE IF EXISTS ref.ref_postal_codes CASCADE;

COMMIT;
