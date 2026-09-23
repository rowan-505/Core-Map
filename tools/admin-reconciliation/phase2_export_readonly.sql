-- Phase 2 read-only CoreMap export for local-admin / village matching.
-- Run inside: BEGIN TRANSACTION READ ONLY; ... COMMIT;
-- Does not write.

\set ON_ERROR_STOP on
\pset footer off
\pset format csv

\echo exporting townships...
\o :townships_csv
SELECT
  a.id,
  a.public_id,
  a.parent_id,
  a.canonical_name,
  t.code AS admin_area_type,
  a.is_active,
  a.is_official_boundary,
  a.is_public_usable,
  a.verification_status,
  a.geometry_source,
  ST_X(ST_PointOnSurface(a.geom)) AS pos_lon,
  ST_Y(ST_PointOnSurface(a.geom)) AS pos_lat,
  ST_AsText(ST_Envelope(a.geom)) AS envelope_wkt,
  ST_AsEWKT(ST_Transform(ST_SetSRID(a.geom, 4326), 4326)) AS geom_ewkt
FROM core.core_admin_areas a
JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
LEFT JOIN ref.ref_admin_area_types t ON t.id = a.admin_area_type_id
WHERE l.code = 'township'
  AND a.is_active
  AND a.deleted_at IS NULL
ORDER BY a.id;

\echo exporting township names...
\o :township_names_csv
SELECT
  n.id,
  n.admin_area_id,
  n.name,
  n.language_code,
  n.name_type,
  n.is_primary
FROM core.core_admin_area_names n
JOIN core.core_admin_areas a ON a.id = n.admin_area_id
JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
WHERE l.code = 'township'
  AND a.is_active
  AND a.deleted_at IS NULL
ORDER BY n.admin_area_id, n.language_code NULLS LAST, n.is_primary DESC, n.id;

\echo exporting ward_village_tract...
\o :wvt_csv
SELECT
  a.id,
  a.public_id,
  a.parent_id,
  a.canonical_name,
  t.code AS admin_area_type,
  a.is_active,
  a.is_official_boundary,
  a.is_public_usable,
  a.verification_status,
  a.geometry_source,
  ST_X(ST_PointOnSurface(a.geom)) AS pos_lon,
  ST_Y(ST_PointOnSurface(a.geom)) AS pos_lat,
  ST_AsText(ST_Envelope(a.geom)) AS envelope_wkt,
  CASE WHEN a.geom IS NULL THEN NULL
       ELSE ST_AsGeoJSON(a.geom, 6)
  END AS geom_geojson
FROM core.core_admin_areas a
JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
LEFT JOIN ref.ref_admin_area_types t ON t.id = a.admin_area_type_id
WHERE l.code = 'ward_village_tract'
  AND a.is_active
  AND a.deleted_at IS NULL
ORDER BY a.id;

\echo exporting wvt names...
\o :wvt_names_csv
SELECT
  n.id,
  n.admin_area_id,
  n.name,
  n.language_code,
  n.name_type,
  n.is_primary
FROM core.core_admin_area_names n
JOIN core.core_admin_areas a ON a.id = n.admin_area_id
JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
WHERE l.code = 'ward_village_tract'
  AND a.is_active
  AND a.deleted_at IS NULL
ORDER BY n.admin_area_id, n.language_code NULLS LAST, n.is_primary DESC, n.id;

\echo exporting parent chain helpers...
\o :admin_parents_csv
SELECT
  a.id,
  a.parent_id,
  l.code AS admin_level,
  t.code AS admin_area_type,
  a.canonical_name
FROM core.core_admin_areas a
JOIN ref.ref_admin_levels l ON l.id = a.admin_level_id
LEFT JOIN ref.ref_admin_area_types t ON t.id = a.admin_area_type_id
WHERE a.is_active
  AND a.deleted_at IS NULL
  AND l.code IN (
    'country', 'state_region', 'district', 'self_administered_zone',
    'township', 'town', 'ward_village_tract'
  )
ORDER BY l.rank, a.id;

\echo exporting settlements village+local_area...
\o :settlements_csv
SELECT
  s.id,
  s.public_id,
  s.canonical_name,
  s.name_mm,
  s.name_en,
  t.code AS settlement_type,
  s.township_id,
  s.is_public,
  s.is_verified,
  s.verification_status,
  ST_X(s.point_geom) AS lon,
  ST_Y(s.point_geom) AS lat
FROM core.core_settlements s
JOIN ref.ref_settlement_types t ON t.id = s.settlement_type_id
WHERE s.deleted_at IS NULL
  AND t.code IN ('village', 'local_area')
  AND s.point_geom IS NOT NULL
ORDER BY s.id;

\echo exporting fk dependency counts...
\o :fk_counts_csv
WITH targets AS (
  SELECT unnest(ARRAY['core_admin_areas', 'core_settlements']) AS target_table
)
SELECT
  target_ns.nspname AS target_schema,
  target.relname AS target_table,
  sn.nspname AS source_schema,
  src.relname AS source_table,
  con.conname AS constraint_name,
  string_agg(sa.attname, ',' ORDER BY u.ord) AS source_columns,
  CASE con.confdeltype
    WHEN 'a' THEN 'no_action'
    WHEN 'r' THEN 'restrict'
    WHEN 'c' THEN 'cascade'
    WHEN 'n' THEN 'set_null'
    WHEN 'd' THEN 'set_default'
  END AS delete_action
FROM pg_constraint con
JOIN pg_class target ON target.oid = con.confrelid
JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_namespace sn ON sn.nspname IS NOT NULL AND sn.oid = src.relnamespace
CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
JOIN pg_attribute sa ON sa.attrelid = src.oid AND sa.attnum = u.attnum
WHERE con.contype = 'f'
  AND target_ns.nspname = 'core'
  AND target.relname IN ('core_admin_areas', 'core_settlements')
GROUP BY target_ns.nspname, target.relname, sn.nspname, src.relname, con.conname, con.confdeltype
ORDER BY target.relname, sn.nspname, src.relname, con.conname;

\o
