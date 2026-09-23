-- Verification companion for 20260921180000_phase5_ref_postal_codes.sql

SELECT
  to_regclass('ref.ref_postal_codes') IS NOT NULL AS table_exists,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='ref' AND table_name='ref_postal_codes' AND column_name='postal_code'
  ) AS has_postal_code,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='ref' AND table_name='ref_postal_codes'
      AND column_name IN ('region_name_mm', 'region_name_my')
  ) AS has_region_mm_or_my,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='ref' AND indexname='ref_postal_codes_township_admin_area_id_idx'
  ) AS has_township_fk_index,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='ref' AND indexname='ref_postal_codes_local_admin_area_id_idx'
  ) AS has_local_fk_index;
