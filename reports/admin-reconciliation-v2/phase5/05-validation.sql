-- Phase 5 post-apply validation (read-only).
-- Run AFTER dry-run plans look correct and ONLY after an intentional apply.

-- A) Postal table shape + constraints
SELECT
  to_regclass('ref.ref_postal_codes') IS NOT NULL AS postal_table_exists,
  (SELECT count(*) FROM ref.ref_postal_codes) AS postal_count,
  (SELECT count(DISTINCT postal_code) FROM ref.ref_postal_codes) AS postal_distinct,
  (SELECT count(*) FROM ref.ref_postal_codes WHERE postal_code !~ '^[0-9]{7}$') AS bad_codes,
  (SELECT count(*) FROM ref.ref_postal_codes WHERE match_status IS NULL OR btrim(match_status) = '') AS null_status;

-- Expect: postal_count = postal_distinct = 17297, bad_codes = 0

-- B) FK orphans
SELECT count(*) AS orphan_township_fk
FROM ref.ref_postal_codes p
LEFT JOIN core.core_admin_areas a ON a.id = p.township_admin_area_id
WHERE p.township_admin_area_id IS NOT NULL AND a.id IS NULL;

SELECT count(*) AS orphan_local_fk
FROM ref.ref_postal_codes p
LEFT JOIN core.core_admin_areas a ON a.id = p.local_admin_area_id
WHERE p.local_admin_area_id IS NOT NULL AND a.id IS NULL;

-- C) Admin level/type invariants for placeholders
SELECT
  count(*) FILTER (WHERE l.code <> 'ward_village_tract') AS bad_level,
  count(*) FILTER (WHERE t.code NOT IN ('ward', 'village_tract')) AS bad_type,
  count(*) FILTER (WHERE a.geom IS NULL OR ST_IsEmpty(a.geom)) AS missing_geom,
  count(*) FILTER (
    WHERE a.geometry_source = 'mimu_placeholder'
      AND (
        a.reference_source IS DISTINCT FROM 'mimu'
        OR a.source_license_status IS DISTINCT FROM 'permission_pending'
        OR a.verification_status IS DISTINCT FROM 'needs_fix'
        OR a.is_verified IS DISTINCT FROM false
        OR a.boundary_status IS DISTINCT FROM 'approximate'
        OR a.is_official_boundary IS DISTINCT FROM false
      )
  ) AS placeholder_meta_mismatch
FROM core.core_admin_areas a
JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
JOIN ref.ref_admin_area_types t ON t.id = a.admin_area_type_id
WHERE a.geometry_source = 'mimu_placeholder'
  AND a.deleted_at IS NULL;

-- D) Existing matched rows must NOT be marked mimu_placeholder by mistake
-- (spot-check: any keep_existing id from plan should retain prior geometry_source if it wasn't placeholder)
SELECT count(*) AS active_wvt
FROM core.core_admin_areas a
JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
WHERE l.code = 'ward_village_tract' AND a.is_active AND a.deleted_at IS NULL;

-- E) Village placeholders: source_refs flags without schema change
SELECT count(*) AS village_placeholders
FROM core.core_settlements s
JOIN ref.ref_source_types st ON st.id = s.source_type_id
WHERE s.deleted_at IS NULL
  AND st.code = 'partner'
  AND coalesce(s.source_refs->>'geometry_status', '') = 'mimu_placeholder'
  AND coalesce((s.source_refs->>'needs_geometry_replacement')::boolean, false) = true
  AND s.verification_status = 'needs_fix'
  AND s.is_verified = false
  AND s.point_geom IS NOT NULL;

-- F) No permanent staging tables created by Phase 5
SELECT to_regclass('public.phase5_staging') AS unexpected_staging,
       to_regclass('ref.phase5_match') AS unexpected_match;
