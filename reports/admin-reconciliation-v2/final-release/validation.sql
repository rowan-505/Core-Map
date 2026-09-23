-- Final release validation on disposable DB (read-only checks).
-- Target: postgresql://postgres@127.0.0.1:5433/coremap_cleanup

\echo '=== 1. COUNTS BY LEVEL ==='
SELECT al.code AS level,
       count(*) FILTER (WHERE a.is_active) AS active,
       count(*) AS total,
       count(*) FILTER (WHERE a.is_active AND a.is_official_boundary) AS official_active,
       count(*) FILTER (WHERE a.is_active AND NOT a.is_official_boundary) AS reference_active,
       count(*) FILTER (WHERE a.is_active AND a.geometry_source = 'mimu_placeholder') AS mimu_placeholder
FROM core.core_admin_areas a
JOIN ref.ref_admin_levels al ON al.id = a.admin_level_id
WHERE a.deleted_at IS NULL
GROUP BY al.code
ORDER BY al.code;

\echo '=== 2. COUNTS BY TYPE ==='
SELECT coalesce(t.code, '(null)') AS type,
       count(*) FILTER (WHERE a.is_active) AS active,
       count(*) FILTER (WHERE a.is_active AND a.is_official_boundary) AS official_active,
       count(*) FILTER (WHERE a.is_active AND NOT a.is_official_boundary) AS reference_active
FROM core.core_admin_areas a
LEFT JOIN ref.ref_admin_area_types t ON t.id = a.admin_area_type_id
WHERE a.deleted_at IS NULL
GROUP BY t.code
ORDER BY active DESC;

\echo '=== 3. RELEASE GATES ==='
WITH country AS (
  SELECT a.id
  FROM core.core_admin_areas a
  JOIN ref.ref_admin_levels al ON al.id = a.admin_level_id
  WHERE al.code = 'country' AND a.deleted_at IS NULL
  LIMIT 1
)
SELECT
  (SELECT count(*) FROM core.core_admin_areas a
     JOIN ref.ref_admin_levels al ON al.id = a.admin_level_id, country c
   WHERE a.deleted_at IS NULL AND a.is_active AND al.code = 'state_region'
     AND a.is_official_boundary AND coalesce(a.is_public_usable,false)
     AND a.parent_id = c.id) AS official_first_level,
  (SELECT count(*) FROM core.core_admin_areas a
     JOIN ref.ref_admin_levels al ON al.id = a.admin_level_id
   WHERE a.deleted_at IS NULL AND a.is_active AND al.code = 'township'
     AND a.is_official_boundary) AS official_township,
  (SELECT count(*) FROM core.core_admin_areas WHERE deleted_at IS NULL AND geometry_source = 'mimu_placeholder') AS mimu_placeholders,
  (SELECT count(*) FROM ref.ref_postal_codes) AS postal_rows,
  (SELECT count(*) FROM ref.ref_postal_codes WHERE postal_code !~ '^[0-9]{7}$') AS postal_invalid,
  (SELECT count(*) FROM ref.ref_postal_codes p
     WHERE p.local_admin_area_id IS NOT NULL AND p.township_admin_area_id IS NULL) AS postal_local_without_township;

\echo '=== 4. OFFICIAL TOWNSHIPS (330 TARGET LIST) ==='
SELECT a.id, a.canonical_name, a.is_official_boundary, a.is_public_usable,
       a.verification_status, a.parent_id, p.canonical_name AS parent_name
FROM core.core_admin_areas a
JOIN ref.ref_admin_levels al ON al.id = a.admin_level_id
LEFT JOIN core.core_admin_areas p ON p.id = a.parent_id
WHERE a.deleted_at IS NULL AND a.is_active AND al.code = 'township' AND a.is_official_boundary
ORDER BY a.canonical_name, a.id;

\echo '=== 5. FOREIGN / DISABLED FLAGS ==='
SELECT a.id, a.canonical_name, a.is_official_boundary, a.is_public_usable, a.is_active,
       a.address_usage, a.boundary_status
FROM core.core_admin_areas a
WHERE a.id IN (5985,5986,6675,6734,6735)
ORDER BY a.id;

\echo '=== 6. NAME COMPLETENESS ==='
SELECT al.code AS level,
       count(DISTINCT a.id) AS areas,
       count(DISTINCT a.id) FILTER (
         WHERE NOT EXISTS (
           SELECT 1 FROM core.core_admin_area_names n
           WHERE n.admin_area_id = a.id AND n.is_primary AND lower(coalesce(n.language_code,'')) IN ('en','eng')
         )
       ) AS missing_primary_en,
       count(DISTINCT a.id) FILTER (
         WHERE NOT EXISTS (
           SELECT 1 FROM core.core_admin_area_names n
           WHERE n.admin_area_id = a.id AND n.is_primary AND lower(coalesce(n.language_code,'')) IN ('my','mm','mya')
         )
       ) AS missing_primary_my
FROM core.core_admin_areas a
JOIN ref.ref_admin_levels al ON al.id = a.admin_level_id
WHERE a.deleted_at IS NULL AND a.is_active
GROUP BY al.code
ORDER BY al.code;

\echo '=== 7. ORPHAN / PARENT INTEGRITY ==='
SELECT count(*) AS orphan_non_country
FROM core.core_admin_areas a
JOIN ref.ref_admin_levels al ON al.id = a.admin_level_id
WHERE a.deleted_at IS NULL AND a.is_active AND al.code <> 'country'
  AND (a.parent_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM core.core_admin_areas p WHERE p.id = a.parent_id AND p.deleted_at IS NULL
  ));

SELECT count(*) AS broken_parent_fk_refs
FROM core.core_admin_areas a
WHERE a.deleted_at IS NULL AND a.parent_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM core.core_admin_areas p WHERE p.id = a.parent_id);

\echo '=== 8. GEOMETRY VALIDITY ==='
SELECT
  count(*) FILTER (WHERE a.geom IS NULL) AS null_geom,
  count(*) FILTER (WHERE a.geom IS NOT NULL AND ST_IsEmpty(a.geom)) AS empty_geom,
  count(*) FILTER (WHERE a.geom IS NOT NULL AND NOT ST_IsEmpty(a.geom) AND NOT ST_IsValid(a.geom)) AS invalid_geom,
  count(*) FILTER (WHERE a.geom IS NOT NULL AND ST_IsValid(a.geom) AND NOT ST_IsEmpty(a.geom)) AS valid_geom
FROM core.core_admin_areas a
WHERE a.deleted_at IS NULL AND a.is_active;

\echo '=== 9. CONTAINMENT WARNINGS (centroid outside Myanmar country) ==='
WITH country AS (
  SELECT geom FROM core.core_admin_areas a
  JOIN ref.ref_admin_levels al ON al.id = a.admin_level_id
  WHERE al.code = 'country' AND a.deleted_at IS NULL AND a.geom IS NOT NULL
  LIMIT 1
)
SELECT count(*) AS outside_country_surface
FROM core.core_admin_areas a, country c
WHERE a.deleted_at IS NULL AND a.is_active AND a.geom IS NOT NULL AND ST_IsValid(a.geom)
  AND NOT ST_Within(ST_PointOnSurface(a.geom), c.geom);

\echo '=== 10. POSTAL LINKAGE ==='
SELECT match_status, count(*) FROM ref.ref_postal_codes GROUP BY 1 ORDER BY 2 DESC;

\echo '=== 11. SETTLEMENTS ==='
-- Relation must exist at parse time for a direct SELECT; probe only here.
-- Production baseline (Phase0): 57,590 settlements. Disposable cleanup DB has no settlements table.
SELECT to_regclass('core.core_settlements') IS NOT NULL AS settlements_table_present;

\echo '=== 12. DUPLICATE OFFICIAL SLUG/PUBLIC_ID ==='
SELECT
  (SELECT count(*) FROM (
     SELECT public_id FROM core.core_admin_areas WHERE deleted_at IS NULL GROUP BY public_id HAVING count(*) > 1
   ) s) AS dup_public_id,
  (SELECT count(*) FROM (
     SELECT slug FROM core.core_admin_areas WHERE deleted_at IS NULL GROUP BY slug HAVING count(*) > 1
   ) s) AS dup_slug;
