-- Phase 6 query-plan checks (disposable DB).
-- Run: psql "$LOCAL" -f reports/admin-reconciliation-v2/phase6/06-query-plans.sql

EXPLAIN (ANALYZE, BUFFERS)
SELECT a.id, a.canonical_name, t.code AS type_code
FROM core.core_admin_areas a
JOIN ref.ref_admin_area_types t ON t.id = a.admin_area_type_id
JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
WHERE l.code = 'ward_village_tract'
  AND a.is_active AND a.deleted_at IS NULL
  AND a.parent_id = 7215
LIMIT 50;

EXPLAIN (ANALYZE, BUFFERS)
SELECT p.postal_code, p.match_status, p.local_admin_area_id, p.township_admin_area_id
FROM ref.ref_postal_codes p
WHERE p.postal_code = '11111'
   OR p.township_admin_area_id = 7215
LIMIT 50;

EXPLAIN (ANALYZE, BUFFERS)
SELECT s.id, s.canonical_name, ST_AsText(s.point_geom)
FROM core.core_settlements s
WHERE s.deleted_at IS NULL
  AND s.township_id = 7215
LIMIT 50;

EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM core.core_admin_areas a
WHERE a.geometry_source = 'mimu_placeholder'
  AND a.deleted_at IS NULL;
