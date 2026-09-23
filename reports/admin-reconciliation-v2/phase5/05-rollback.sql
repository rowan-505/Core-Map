-- Phase 5 rollback helpers (data + DDL alignment).
-- STOP: review carefully. Prefer restoring from pre-import snapshot CSVs.
--
-- 1) Soft-delete Phase-5 created admin placeholders (by geometry_source + boundary_note).
-- 2) Clear village source_refs Phase-5 markers (does not delete settlements if they existed).
-- 3) Optionally restore postal match_status / columns via snapshot.
-- 4) DDL rename rollback is in:
--    infrastructure/database/migrations/supabase/20260921180000_phase5_ref_postal_codes.rollback.sql

BEGIN;

-- A) Soft-retire admin placeholders created by Phase 5
UPDATE core.core_admin_areas
SET
  is_active = false,
  deleted_at = COALESCE(deleted_at, now()),
  updated_at = now()
WHERE geometry_source = 'mimu_placeholder'
  AND reference_source = 'mimu'
  AND boundary_note = 'phase5:create_mimu_placeholder'
  AND deleted_at IS NULL;

-- B) Soft-retire village placeholders created by Phase 5 (source_refs marker)
UPDATE core.core_settlements
SET
  deleted_at = COALESCE(deleted_at, now()),
  updated_at = now()
WHERE deleted_at IS NULL
  AND coalesce(source_refs->>'geometry_status', '') = 'mimu_placeholder'
  AND coalesce((source_refs->>'phase5_manifest_import')::boolean, false) = true;

-- C) Re-activate merge losers only if you have a snapshot list — DO NOT blind-activate.
-- Example (fill IDs from snapshot):
-- UPDATE core.core_admin_areas SET is_active=true, deleted_at=NULL, updated_at=now()
-- WHERE id = ANY(ARRAY[]::bigint[]);

COMMIT;

-- Destructive DDL (fresh env only) is commented in the migration rollback file.
