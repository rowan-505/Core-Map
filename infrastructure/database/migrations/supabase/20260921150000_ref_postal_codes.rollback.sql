-- Rollback for 20260921150000_ref_postal_codes.sql

BEGIN;

DROP TABLE IF EXISTS ref.ref_postal_codes CASCADE;

COMMIT;
