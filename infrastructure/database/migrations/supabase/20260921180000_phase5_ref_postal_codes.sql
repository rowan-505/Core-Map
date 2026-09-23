-- Phase 5: ref.ref_postal_codes
-- Create only if missing. Align existing table to Phase-5 column names + statuses.
-- Does NOT import data. Does NOT create staging/matching tables.
--
-- Preferred columns (new installs):
--   region_name_mm / township_name_mm / locality_name_mm
-- Existing installs that used *_my are renamed to *_mm when safe.

BEGIN;

CREATE SCHEMA IF NOT EXISTS ref;

CREATE TABLE IF NOT EXISTS ref.ref_postal_codes (
  id bigserial PRIMARY KEY,
  postal_code text NOT NULL,
  township_admin_area_id bigint
    REFERENCES core.core_admin_areas (id) ON DELETE SET NULL,
  local_admin_area_id bigint
    REFERENCES core.core_admin_areas (id) ON DELETE SET NULL,
  region_name_mm text,
  region_name_en text,
  township_name_mm text,
  township_name_en text,
  locality_name_mm text,
  locality_name_en text,
  locality_type text,
  match_status text NOT NULL,
  match_method text,
  source_version text NOT NULL DEFAULT 'V1.0 (September 2021)',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ref_postal_codes_postal_code_chk
    CHECK (postal_code ~ '^[0-9]{7}$'),
  CONSTRAINT ref_postal_codes_postal_code_key UNIQUE (postal_code),
  CONSTRAINT ref_postal_codes_locality_type_chk
    CHECK (locality_type IS NULL OR locality_type IN ('ward', 'village_tract')),
  CONSTRAINT ref_postal_codes_match_status_chk
    CHECK (match_status IN (
      'linked_exact_local_area',
      'linked_after_review',
      'ambiguous_local_area',
      'missing_local_area',
      'non_admin_postal_locality',
      -- legacy Phase-1/2 statuses (kept for already-imported rows)
      'linked_local_area',
      'linked_township_only',
      'ambiguous',
      'unmatched'
    )),
  CONSTRAINT ref_postal_codes_local_requires_township_chk
    CHECK (local_admin_area_id IS NULL OR township_admin_area_id IS NOT NULL)
);

COMMENT ON TABLE ref.ref_postal_codes IS
  'Myanmar Post postal codes. API-only. Valid codes are exactly seven ASCII digits.';

-- Rename legacy *_my → *_mm when present (idempotent).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ref' AND table_name = 'ref_postal_codes'
      AND column_name = 'region_name_my'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ref' AND table_name = 'ref_postal_codes'
      AND column_name = 'region_name_mm'
  ) THEN
    ALTER TABLE ref.ref_postal_codes RENAME COLUMN region_name_my TO region_name_mm;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ref' AND table_name = 'ref_postal_codes'
      AND column_name = 'township_name_my'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ref' AND table_name = 'ref_postal_codes'
      AND column_name = 'township_name_mm'
  ) THEN
    ALTER TABLE ref.ref_postal_codes RENAME COLUMN township_name_my TO township_name_mm;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ref' AND table_name = 'ref_postal_codes'
      AND column_name = 'locality_name_my'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ref' AND table_name = 'ref_postal_codes'
      AND column_name = 'locality_name_mm'
  ) THEN
    ALTER TABLE ref.ref_postal_codes RENAME COLUMN locality_name_my TO locality_name_mm;
  END IF;
END $$;

-- Ensure required columns exist on older installs.
ALTER TABLE ref.ref_postal_codes
  ADD COLUMN IF NOT EXISTS region_name_mm text,
  ADD COLUMN IF NOT EXISTS region_name_en text,
  ADD COLUMN IF NOT EXISTS township_name_mm text,
  ADD COLUMN IF NOT EXISTS township_name_en text,
  ADD COLUMN IF NOT EXISTS locality_name_mm text,
  ADD COLUMN IF NOT EXISTS locality_name_en text,
  ADD COLUMN IF NOT EXISTS locality_type text,
  ADD COLUMN IF NOT EXISTS match_status text,
  ADD COLUMN IF NOT EXISTS match_method text,
  ADD COLUMN IF NOT EXISTS source_version text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS township_admin_area_id bigint,
  ADD COLUMN IF NOT EXISTS local_admin_area_id bigint;

-- Expand match_status check for Phase-4 values (drop + recreate).
ALTER TABLE ref.ref_postal_codes
  DROP CONSTRAINT IF EXISTS ref_postal_codes_match_status_chk;

ALTER TABLE ref.ref_postal_codes
  ADD CONSTRAINT ref_postal_codes_match_status_chk
  CHECK (match_status IN (
    'linked_exact_local_area',
    'linked_after_review',
    'ambiguous_local_area',
    'missing_local_area',
    'non_admin_postal_locality',
    'linked_local_area',
    'linked_township_only',
    'ambiguous',
    'unmatched'
  ));

-- Unique + seven-digit check + FKs (idempotent via constraint name checks).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ref_postal_codes_postal_code_chk'
  ) THEN
    ALTER TABLE ref.ref_postal_codes
      ADD CONSTRAINT ref_postal_codes_postal_code_chk
      CHECK (postal_code ~ '^[0-9]{7}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ref_postal_codes_postal_code_key'
  ) THEN
    ALTER TABLE ref.ref_postal_codes
      ADD CONSTRAINT ref_postal_codes_postal_code_key UNIQUE (postal_code);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ref_postal_codes_locality_type_chk'
  ) THEN
    ALTER TABLE ref.ref_postal_codes
      ADD CONSTRAINT ref_postal_codes_locality_type_chk
      CHECK (locality_type IS NULL OR locality_type IN ('ward', 'village_tract'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ref_postal_codes_local_requires_township_chk'
  ) THEN
    ALTER TABLE ref.ref_postal_codes
      ADD CONSTRAINT ref_postal_codes_local_requires_township_chk
      CHECK (local_admin_area_id IS NULL OR township_admin_area_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ref_postal_codes_township_admin_area_id_fkey'
  ) THEN
    ALTER TABLE ref.ref_postal_codes
      ADD CONSTRAINT ref_postal_codes_township_admin_area_id_fkey
      FOREIGN KEY (township_admin_area_id)
      REFERENCES core.core_admin_areas (id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ref_postal_codes_local_admin_area_id_fkey'
  ) THEN
    ALTER TABLE ref.ref_postal_codes
      ADD CONSTRAINT ref_postal_codes_local_admin_area_id_fkey
      FOREIGN KEY (local_admin_area_id)
      REFERENCES core.core_admin_areas (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ref_postal_codes_township_admin_area_id_idx
  ON ref.ref_postal_codes (township_admin_area_id)
  WHERE township_admin_area_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ref_postal_codes_local_admin_area_id_idx
  ON ref.ref_postal_codes (local_admin_area_id)
  WHERE local_admin_area_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ref_postal_codes_match_status_idx
  ON ref.ref_postal_codes (match_status);

ALTER TABLE ref.ref_postal_codes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE ref.ref_postal_codes FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'ref' AND c.relname = 'ref_postal_codes_id_seq'
  ) THEN
    EXECUTE 'REVOKE ALL ON SEQUENCE ref.ref_postal_codes_id_seq FROM PUBLIC';
  END IF;
END $$;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE ref.ref_postal_codes FROM %I', role_name);
      IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'ref' AND c.relname = 'ref_postal_codes_id_seq'
      ) THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE ref.ref_postal_codes_id_seq FROM %I', role_name);
      END IF;
    END IF;
  END LOOP;
END $$;

COMMIT;
