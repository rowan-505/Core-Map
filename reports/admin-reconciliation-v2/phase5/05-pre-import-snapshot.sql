-- Phase 5 pre-import snapshot / export (read-only SELECT … COPY recommended).
-- Run BEFORE apply. Does not modify data.
--
-- Example:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -c "\copy ( <query> ) TO 'reports/admin-reconciliation-v2/phase5/snapshot/....csv' CSV HEADER"

-- 1) Admin areas that may be touched (active WVT + any mimu_placeholder)
SELECT
  a.id,
  a.public_id,
  a.parent_id,
  l.code AS admin_level_code,
  t.code AS admin_area_type_code,
  a.canonical_name,
  a.geometry_source,
  a.reference_source,
  a.source_license_status,
  a.verification_status,
  a.is_verified,
  a.boundary_status,
  a.is_official_boundary,
  a.is_active,
  a.deleted_at,
  md5(ST_AsBinary(a.geom)) AS geom_md5,
  a.updated_at
FROM core.core_admin_areas a
JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
JOIN ref.ref_admin_area_types t ON t.id = a.admin_area_type_id
WHERE l.code = 'ward_village_tract'
   OR a.geometry_source = 'mimu_placeholder'
ORDER BY a.id;

-- 2) Settlements snapshot
SELECT
  s.id,
  s.public_id,
  s.canonical_name,
  s.name_mm,
  s.name_en,
  s.township_id,
  s.source_type_id,
  st.code AS source_type_code,
  s.source_refs,
  s.verification_status,
  s.is_verified,
  ST_AsText(s.point_geom) AS point_wkt,
  s.deleted_at,
  s.updated_at
FROM core.core_settlements s
LEFT JOIN ref.ref_source_types st ON st.id = s.source_type_id
WHERE s.deleted_at IS NULL
ORDER BY s.id;

-- 3) Postal codes snapshot (if table exists)
SELECT
  p.id,
  p.postal_code,
  p.township_admin_area_id,
  p.local_admin_area_id,
  p.match_status,
  p.match_method,
  p.source_version,
  p.updated_at
FROM ref.ref_postal_codes p
ORDER BY p.postal_code;

-- 4) Counts
SELECT
  (SELECT count(*) FROM core.core_admin_areas a
     JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
    WHERE l.code = 'ward_village_tract' AND a.is_active AND a.deleted_at IS NULL) AS active_wvt,
  (SELECT count(*) FROM core.core_admin_areas
    WHERE geometry_source = 'mimu_placeholder' AND deleted_at IS NULL) AS mimu_placeholder,
  (SELECT count(*) FROM core.core_settlements WHERE deleted_at IS NULL) AS settlements,
  (SELECT count(*) FROM ref.ref_postal_codes) AS postal_rows;
