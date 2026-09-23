\set ON_ERROR_STOP on
\pset footer off
\pset format csv

BEGIN TRANSACTION READ ONLY;

\o :areas_csv
SELECT
    a.id,
    a.public_id,
    a.parent_id,
    l.code AS admin_level,
    l.rank AS admin_rank,
    t.code AS admin_area_type,
    a.canonical_name,
    a.slug,
    a.external_id,
    a.is_active,
    a.deleted_at,
    a.is_official_boundary,
    a.is_public_usable,
    a.address_usage,
    a.boundary_status,
    a.verification_status,
    a.geometry_source,
    a.reference_source,
    a.source_license_status,
    a.source_refs::text AS source_refs,
    a.normalized_data::text AS normalized_data,
    md5(ST_AsEWKB(a.geom)) AS geom_md5,
    ST_X(ST_PointOnSurface(a.geom)) AS point_x,
    ST_Y(ST_PointOnSurface(a.geom)) AS point_y,
    CASE
        WHEN l.code IN ('country', 'state_region', 'district', 'self_administered_zone', 'township')
        THEN ST_AsText(a.geom)
        ELSE NULL
    END AS geom_wkt
FROM core.core_admin_areas AS a
JOIN ref.ref_admin_levels AS l ON l.id = a.admin_level_id
LEFT JOIN ref.ref_admin_area_types AS t ON t.id = a.admin_area_type_id
ORDER BY l.rank, a.id;

\o :names_csv
SELECT
    n.id,
    n.admin_area_id,
    n.name,
    n.language_code,
    n.script_code,
    n.name_type,
    n.is_primary,
    n.search_weight
FROM core.core_admin_area_names AS n
ORDER BY n.admin_area_id, n.language_code NULLS LAST, n.is_primary DESC, n.id;

\o :fks_csv
SELECT
    con.conname AS constraint_name,
    sn.nspname AS source_schema,
    src.relname AS source_table,
    string_agg(sa.attname, ', ' ORDER BY u.ord) AS source_columns,
    CASE con.confdeltype
        WHEN 'a' THEN 'no_action'
        WHEN 'r' THEN 'restrict'
        WHEN 'c' THEN 'cascade'
        WHEN 'n' THEN 'set_null'
        WHEN 'd' THEN 'set_default'
    END AS delete_action,
    con.convalidated AS validated
FROM pg_constraint AS con
JOIN pg_class AS target ON target.oid = con.confrelid
JOIN pg_namespace AS target_ns ON target_ns.oid = target.relnamespace
JOIN pg_class AS src ON src.oid = con.conrelid
JOIN pg_namespace AS sn ON sn.oid = src.relnamespace
CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
JOIN pg_attribute AS sa ON sa.attrelid = src.oid AND sa.attnum = u.attnum
WHERE con.contype = 'f'
  AND target_ns.nspname = 'core'
  AND target.relname = 'core_admin_areas'
GROUP BY con.conname, sn.nspname, src.relname, con.confdeltype, con.convalidated
ORDER BY sn.nspname, src.relname, con.conname;

\o :baseline_csv
WITH level_counts AS (
    SELECT
        l.code AS admin_level,
        count(*) FILTER (WHERE a.is_active AND a.deleted_at IS NULL) AS active_count,
        count(*) AS total_count
    FROM core.core_admin_areas AS a
    JOIN ref.ref_admin_levels AS l ON l.id = a.admin_level_id
    GROUP BY l.code
),
townships AS (
    SELECT a.*
    FROM core.core_admin_areas AS a
    JOIN ref.ref_admin_levels AS l ON l.id = a.admin_level_id
    WHERE l.code = 'township' AND a.is_active AND a.deleted_at IS NULL
),
township_name_rows AS (
    SELECT n.*
    FROM core.core_admin_area_names AS n
    JOIN townships AS t ON t.id = n.admin_area_id
),
same_area_name_duplicates AS (
    SELECT sum(row_count - 1)::bigint AS duplicate_extra_rows
    FROM (
        SELECT count(*) AS row_count
        FROM township_name_rows
        GROUP BY admin_area_id, coalesce(language_code, ''), lower(btrim(name))
        HAVING count(*) > 1
    ) AS grouped
),
cross_area_name_duplicates AS (
    SELECT sum(row_count - 1)::bigint AS duplicate_extra_rows
    FROM (
        SELECT count(DISTINCT admin_area_id) AS row_count
        FROM township_name_rows
        GROUP BY coalesce(language_code, ''), lower(btrim(name))
        HAVING count(DISTINCT admin_area_id) > 1
    ) AS grouped
)
SELECT 'level_count:' || admin_level AS metric, active_count::text AS value, total_count::text AS detail
FROM level_counts
UNION ALL
SELECT 'township_centroid_outside_immediate_parent', count(*)::text, NULL
FROM townships AS t
JOIN core.core_admin_areas AS p ON p.id = t.parent_id
WHERE NOT ST_Covers(p.geom, ST_PointOnSurface(t.geom))
UNION ALL
SELECT 'township_geom_not_completely_covered_by_parent', count(*)::text, NULL
FROM townships AS t
JOIN core.core_admin_areas AS p ON p.id = t.parent_id
WHERE NOT ST_CoveredBy(t.geom, p.geom)
UNION ALL
SELECT 'township_exact_duplicate_name_extra_rows_same_area', coalesce(duplicate_extra_rows, 0)::text, NULL
FROM same_area_name_duplicates
UNION ALL
SELECT 'township_exact_duplicate_name_extra_rows_cross_area', coalesce(duplicate_extra_rows, 0)::text, NULL
FROM cross_area_name_duplicates
UNION ALL
SELECT 'townships_without_primary_en', count(*)::text, NULL
FROM townships AS t
WHERE NOT EXISTS (
    SELECT 1 FROM core.core_admin_area_names AS n
    WHERE n.admin_area_id = t.id AND n.language_code = 'en' AND n.is_primary
)
UNION ALL
SELECT 'townships_without_primary_my', count(*)::text, NULL
FROM townships AS t
WHERE NOT EXISTS (
    SELECT 1 FROM core.core_admin_area_names AS n
    WHERE n.admin_area_id = t.id AND n.language_code = 'my' AND n.is_primary
)
ORDER BY metric;

\o :foreign_dependencies_csv
SELECT 'core.core_admin_areas' AS source_table, 'parent_id' AS source_column, parent_id AS admin_area_id, count(*) AS row_count
FROM core.core_admin_areas WHERE parent_id IN (5985, 5986, 6675, 6734, 6735) GROUP BY parent_id
UNION ALL SELECT 'core.core_addresses', 'admin_area_id', admin_area_id, count(*) FROM core.core_addresses WHERE admin_area_id IN (5985, 5986, 6675, 6734, 6735) GROUP BY admin_area_id
UNION ALL SELECT 'core.core_buildings', 'admin_area_id', admin_area_id, count(*) FROM core.core_buildings WHERE admin_area_id IN (5985, 5986, 6675, 6734, 6735) GROUP BY admin_area_id
UNION ALL SELECT 'core.core_land_areas', 'admin_area_id', admin_area_id, count(*) FROM core.core_land_areas WHERE admin_area_id IN (5985, 5986, 6675, 6734, 6735) GROUP BY admin_area_id
UNION ALL SELECT 'core.core_places', 'admin_area_id', admin_area_id, count(*) FROM core.core_places WHERE admin_area_id IN (5985, 5986, 6675, 6734, 6735) GROUP BY admin_area_id
UNION ALL SELECT 'core.core_protected_areas', 'admin_area_id', admin_area_id, count(*) FROM core.core_protected_areas WHERE admin_area_id IN (5985, 5986, 6675, 6734, 6735) GROUP BY admin_area_id
UNION ALL SELECT 'core.core_settlements', 'township_id', township_id, count(*) FROM core.core_settlements WHERE township_id IN (5985, 5986, 6675, 6734, 6735) GROUP BY township_id
UNION ALL SELECT 'core.core_streets', 'admin_area_id', admin_area_id, count(*) FROM core.core_streets WHERE admin_area_id IN (5985, 5986, 6675, 6734, 6735) GROUP BY admin_area_id
UNION ALL SELECT 'transport.stops', 'admin_area_id', admin_area_id, count(*) FROM transport.stops WHERE admin_area_id IN (5985, 5986, 6675, 6734, 6735) GROUP BY admin_area_id
UNION ALL SELECT 'transport.terminals', 'admin_area_id', admin_area_id, count(*) FROM transport.terminals WHERE admin_area_id IN (5985, 5986, 6675, 6734, 6735) GROUP BY admin_area_id
UNION ALL SELECT 'transport.routes', 'origin_admin_area_id', origin_admin_area_id, count(*) FROM transport.routes WHERE origin_admin_area_id IN (5985, 5986, 6675, 6734, 6735) GROUP BY origin_admin_area_id
UNION ALL SELECT 'transport.routes', 'destination_admin_area_id', destination_admin_area_id, count(*) FROM transport.routes WHERE destination_admin_area_id IN (5985, 5986, 6675, 6734, 6735) GROUP BY destination_admin_area_id
ORDER BY admin_area_id, source_table, source_column;

\o
ROLLBACK;
