-- OBSOLETE: the 48 places were later hard-deleted.
-- See 20260922_hard_delete_test_and_private_places.sql
-- This rollback cannot restore those rows.

UPDATE core.core_places
SET
    deleted_at = NULL,
    updated_at = now(),
    is_public = true
WHERE id IN (
    15485, 15501, 15508, 15732, 15800, 16014, 16335, 16810, 18617, 19124,
    19184, 19652, 20113, 79586, 79812, 80817, 80929, 81658, 82413, 83226,
    83862, 84911, 86504, 88000, 89488, 90513, 95008, 102410, 109130, 111100,
    111584, 113335, 113600, 116107, 122554, 124293, 126941
)
  AND deleted_at IS NOT NULL;

-- After restore, rebuild place search:
-- SELECT search.rebuild_search_documents(ARRAY['places']);
