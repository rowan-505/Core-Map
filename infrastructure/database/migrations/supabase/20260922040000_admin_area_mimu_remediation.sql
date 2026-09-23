-- Phase 7 follow-on: MIMU remediation evidence + decision columns on core_admin_areas.
-- Dashboard remediation only. Does not publish placeholders to public search/tiles/CDN.

BEGIN;

ALTER TABLE core.core_admin_areas
  ADD COLUMN IF NOT EXISTS evidence jsonb NULL;

ALTER TABLE core.core_admin_areas
  ADD COLUMN IF NOT EXISTS remediation_decision text NULL;

ALTER TABLE core.core_admin_areas
  DROP CONSTRAINT IF EXISTS core_admin_areas_remediation_decision_chk;

ALTER TABLE core.core_admin_areas
  ADD CONSTRAINT core_admin_areas_remediation_decision_chk
  CHECK (
    remediation_decision IS NULL
    OR remediation_decision IN (
      'keep_database_only',
      'replace_source',
      'approximate',
      'needs_evidence',
      'reject'
    )
  );

COMMENT ON COLUMN core.core_admin_areas.evidence IS
  'Nullable supporting proof for MIMU remediation. Shape: {"items":[{type,value,label,note,captured_at,storage_path?,sha256?}]}. Private storage_path only; never public URLs. Origin stays in source_refs.';

COMMENT ON COLUMN core.core_admin_areas.remediation_decision IS
  'Dashboard MIMU remediation decision. Placeholders remain non-public until geometry_source and licence permit publication (separate production approval).';

CREATE INDEX IF NOT EXISTS core_admin_areas_remediation_decision_idx
  ON core.core_admin_areas (remediation_decision)
  WHERE remediation_decision IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS core_admin_areas_has_evidence_idx
  ON core.core_admin_areas ((evidence IS NOT NULL))
  WHERE evidence IS NOT NULL AND deleted_at IS NULL;

COMMIT;
