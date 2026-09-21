-- Rollback is intentionally incomplete: Import Review was permanently removed.
-- Restore only from backup / historical migrations if ever required.
-- This file exists so operators do not expect CASCADE recreate.
SELECT 'import_review schema was permanently dropped; restore from backup if needed'::text AS notice;
