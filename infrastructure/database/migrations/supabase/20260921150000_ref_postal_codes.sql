-- ref.ref_postal_codes: Myanmar Post reference lookup (API-only).
-- Does not overwrite core.core_addresses.postal_code.
-- Data import is performed by tools/admin-reconciliation/postal_import.py (not this DDL).

BEGIN;

CREATE TABLE IF NOT EXISTS ref.ref_postal_codes (
  id bigserial PRIMARY KEY,
  postal_code text NOT NULL,
  region_name_en text,
  region_name_my text,
  township_name_en text,
  township_name_my text,
  locality_name_en text,
  locality_name_my text,
  locality_type text,
  township_admin_area_id bigint
    REFERENCES core.core_admin_areas (id) ON DELETE SET NULL,
  local_admin_area_id bigint
    REFERENCES core.core_admin_areas (id) ON DELETE SET NULL,
  match_status text NOT NULL,
  match_method text,
  source_name text NOT NULL DEFAULT 'Myanmar Post',
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
      'linked_local_area',
      'linked_township_only',
      'ambiguous',
      'unmatched',
      'malformed_rejected'
    )),
  CONSTRAINT ref_postal_codes_local_requires_township_chk
    CHECK (local_admin_area_id IS NULL OR township_admin_area_id IS NOT NULL),
  CONSTRAINT ref_postal_codes_malformed_not_stored_chk
    CHECK (match_status <> 'malformed_rejected')
);

COMMENT ON TABLE ref.ref_postal_codes IS
  'Myanmar Post V1.0 postal codes (17,297 valid). API-only; not exposed to anon/authenticated Supabase roles.';

-- Lookup by postal_code is covered by UNIQUE.
-- FK indexes for join/validation and township-scoped queries from the API.
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
REVOKE ALL ON SEQUENCE ref.ref_postal_codes_id_seq FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE ref.ref_postal_codes FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON SEQUENCE ref.ref_postal_codes_id_seq FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
