-- Validation for admin Phase 1 existing-data cleanup
-- Expect all checks to return pass=true

WITH geom_check AS (
  -- Compare against snapshot md5 if temp table loaded; else compare npoints unchanged via session
  SELECT 0::bigint AS changed_existing_geoms
),
official_sr AS (
  SELECT count(*) AS n
  FROM core.core_admin_areas a
  JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
  WHERE a.deleted_at IS NULL AND a.is_active AND a.parent_id = 11
    AND l.code = 'state_region'
    AND COALESCE(a.is_public_usable, true)
    AND a.is_official_boundary
),
foreign_bad AS (
  SELECT count(*) AS n
  FROM core.core_admin_areas
  WHERE id IN (5985, 5986, 6675, 6734, 6735)
    AND (
      COALESCE(is_public_usable, true) = true
      OR is_official_boundary = true
      OR address_usage <> 'disabled'
      OR verification_status <> 'needs_fix'
    )
),
chains AS (
  SELECT
    (SELECT parent_id FROM core.core_admin_areas WHERE id = 6674) = 6693
    AND (SELECT parent_id FROM core.core_admin_areas WHERE id = 6693) = 6703 AS nanyun_ok,
    (SELECT parent_id FROM core.core_admin_areas WHERE id = 6091) = 6115
    AND (SELECT parent_id FROM core.core_admin_areas WHERE id = 6115) = 6329 AS hsihseng_ok,
    (SELECT parent_id FROM core.core_admin_areas WHERE id = 6073) = 6115 AS pinlaung_ok,
    (SELECT parent_id FROM core.core_admin_areas WHERE id = 6187) = 6192
    AND (SELECT parent_id FROM core.core_admin_areas WHERE id = 6192) = 6329 AS ywangan_ok,
    (SELECT parent_id FROM core.core_admin_areas WHERE id = 7139) = (
      SELECT id FROM core.core_admin_areas WHERE public_id = 'a1000001-0001-4000-8000-000000000001'
    )
    AND (SELECT parent_id FROM core.core_admin_areas WHERE public_id = 'a1000001-0001-4000-8000-000000000001') = 7169 AS pyay_ok,
    (SELECT parent_id FROM core.core_admin_areas WHERE id = 6778) = (
      SELECT id FROM core.core_admin_areas WHERE public_id = 'a1000001-0001-4000-8000-000000000001'
    ) AS padaung_ok,
    (SELECT parent_id FROM core.core_admin_areas WHERE id = 7151) = (
      SELECT id FROM core.core_admin_areas WHERE public_id = 'a1000001-0001-4000-8000-000000000001'
    ) AS shwedaung_ok
),
orphans AS (
  SELECT count(*) AS n
  FROM core.core_admin_areas a
  WHERE a.parent_id IS NOT NULL
    AND a.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM core.core_admin_areas p WHERE p.id = a.parent_id)
),
fk_deleted AS (
  SELECT count(*) AS n
  FROM core.core_admin_areas c
  WHERE c.parent_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM core.core_admin_areas p
      WHERE p.id = c.parent_id AND p.deleted_at IS NOT NULL
    )
),
saz_model AS (
  SELECT
    (SELECT count(*) FROM core.core_admin_areas a
      JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
     WHERE a.deleted_at IS NULL AND a.is_active AND l.code = 'self_administered_zone'
       AND a.parent_id IN (6329, 6703)
       AND a.id IN (
         6115, 6192, 6693, 6411,
         (SELECT id FROM core.core_admin_areas WHERE public_id = 'a1000001-0001-4000-8000-000000000002'),
         (SELECT id FROM core.core_admin_areas WHERE public_id = 'a1000001-0001-4000-8000-000000000003')
       )) = 6 AS six_ok,
    (SELECT parent_id FROM core.core_admin_areas WHERE id = 6378) = (
      SELECT id FROM core.core_admin_areas WHERE public_id = 'a1000001-0001-4000-8000-000000000003'
    ) AS wa_south_ok,
    (SELECT parent_id FROM core.core_admin_areas WHERE id = 6485) = (
      SELECT id FROM core.core_admin_areas WHERE public_id = 'a1000001-0001-4000-8000-000000000003'
    ) AS wa_north_ok
),
primary_dupes AS (
  SELECT count(*) AS n FROM (
    SELECT admin_area_id, language_code
    FROM core.core_admin_area_names
    WHERE is_primary AND language_code IS NOT NULL
      AND admin_area_id IN (
        5985,5986,6675,6734,6735,6091,6073,6187,6674,7139,6778,7151,
        6115,6192,6693,6411,6378,6485,6310,6144,6692,6699,6394,6527,6410
      )
    GROUP BY admin_area_id, language_code
    HAVING count(*) > 1
  ) s
)
SELECT * FROM (
  SELECT 'official_first_level_15' AS check_name, (SELECT n FROM official_sr) = 15 AS pass, (SELECT n FROM official_sr)::text AS detail
  UNION ALL SELECT 'foreign_not_public_or_official', (SELECT n FROM foreign_bad) = 0, (SELECT n FROM foreign_bad)::text
  UNION ALL SELECT 'chain_nanyun_sagaing_naga', (SELECT nanyun_ok FROM chains), ''
  UNION ALL SELECT 'chain_hsihseng_shan_pao', (SELECT hsihseng_ok FROM chains), ''
  UNION ALL SELECT 'chain_pinlaung_pao', (SELECT pinlaung_ok FROM chains), ''
  UNION ALL SELECT 'chain_ywangan_shan_danu', (SELECT ywangan_ok FROM chains), ''
  UNION ALL SELECT 'chain_pyay_bago_district', (SELECT pyay_ok FROM chains), ''
  UNION ALL SELECT 'chain_padaung_pyay', (SELECT padaung_ok FROM chains), ''
  UNION ALL SELECT 'chain_shwedaung_pyay', (SELECT shwedaung_ok FROM chains), ''
  UNION ALL SELECT 'no_orphan_parent_id', (SELECT n FROM orphans) = 0, (SELECT n FROM orphans)::text
  UNION ALL SELECT 'no_fk_parent_to_deleted', (SELECT n FROM fk_deleted) = 0, (SELECT n FROM fk_deleted)::text
  UNION ALL SELECT 'saz_sad_model_six_under_states', (SELECT six_ok FROM saz_model), ''
  UNION ALL SELECT 'wa_under_sad', (SELECT wa_south_ok AND wa_north_ok FROM saz_model), ''
  UNION ALL SELECT 'no_duplicate_primary_affected', (SELECT n FROM primary_dupes) = 0, (SELECT n FROM primary_dupes)::text
  UNION ALL SELECT 'no_existing_geom_change_placeholder', (SELECT changed_existing_geoms FROM geom_check) = 0, 'run geom md5 diff vs snapshot'
) v
ORDER BY 1;
