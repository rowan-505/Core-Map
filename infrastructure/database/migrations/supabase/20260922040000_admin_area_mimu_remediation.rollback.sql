BEGIN;

DROP INDEX IF EXISTS core.core_admin_areas_has_evidence_idx;
DROP INDEX IF EXISTS core.core_admin_areas_remediation_decision_idx;

ALTER TABLE core.core_admin_areas
  DROP CONSTRAINT IF EXISTS core_admin_areas_remediation_decision_chk;

ALTER TABLE core.core_admin_areas
  DROP COLUMN IF EXISTS remediation_decision;

ALTER TABLE core.core_admin_areas
  DROP COLUMN IF EXISTS evidence;

COMMIT;
