-- Phase 7 data rollback (soft-retire Phase6/7 placeholders; restore postal via backup dump).
-- TESTED with BEGIN ... ROLLBACK on disposable coremap_phase6 (see 07-rollback-test.log).
-- Prefer restore from backup/07-prod-prephase7-affected.dump for full production recovery.

BEGIN;

-- A) Soft-retire admin placeholders created by Phase 6/7
UPDATE core.core_admin_areas
SET
  is_active = false,
  deleted_at = COALESCE(deleted_at, now()),
  updated_at = now()
WHERE geometry_source = 'mimu_placeholder'
  AND reference_source = 'mimu'
  AND (
    boundary_note LIKE 'phase6:create_mimu_placeholder%'
    OR boundary_note LIKE 'phase5:create_mimu_placeholder%'
    OR coalesce(normalized_data->>'phase5_manifest_import','') IN ('true','t')
    OR coalesce((normalized_data->>'phase5_manifest_import')::text,'') = 'true'
  )
  AND deleted_at IS NULL;

-- B) Soft-retire village placeholders created by Phase 6/7
UPDATE core.core_settlements
SET
  deleted_at = COALESCE(deleted_at, now()),
  updated_at = now()
WHERE deleted_at IS NULL
  AND coalesce(source_refs->>'geometry_status', '') = 'mimu_placeholder'
  AND (
    coalesce((source_refs->>'phase5_manifest_import')::boolean, false) = true
    OR coalesce(source_refs->>'source_key','') <> ''
  );

-- C) Postal: do not DELETE here. Restore from backup dump:
--    pg_restore --data-only -t ref.ref_postal_codes 07-prod-prephase7-affected.dump
-- Or truncate+reload from exports/07-export-postal-codes.csv only if that export is pre-apply.

-- STOP: for disposable test use ROLLBACK; for real rollback use COMMIT after review.
ROLLBACK;
