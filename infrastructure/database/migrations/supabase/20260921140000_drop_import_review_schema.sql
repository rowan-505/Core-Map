-- Drop obsolete Import Review schema after detaching external FKs.
-- Keeps source_review_batch_id / source_publish_batch_id columns as orphan lineage.
-- Does NOT modify or delete rows in core.*, search.*, transport.*, or system_publish_batches.
--
-- CASCADE on DROP SCHEMA is required to remove objects *inside* import_review.
-- External FKs are dropped first so CASCADE cannot touch routing/system tables.

BEGIN;

ALTER TABLE IF EXISTS routing.routing_build_jobs
  DROP CONSTRAINT IF EXISTS routing_build_jobs_source_review_batch_id_fkey;

ALTER TABLE IF EXISTS routing.routing_build_sources
  DROP CONSTRAINT IF EXISTS routing_build_sources_review_batch_id_fkey;

ALTER TABLE IF EXISTS system.system_publish_batches
  DROP CONSTRAINT IF EXISTS system_publish_batches_review_batch_id_fkey;

DROP SCHEMA IF EXISTS import_review CASCADE;

COMMIT;
