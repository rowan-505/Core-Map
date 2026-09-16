SELECT
  system.pipeline_osm_identity_key(b.external_id) AS feature_key,
  b.id AS core_id,
  b.public_id AS core_public_id,
  COALESCE(NULLIF(btrim(bt.code), ''), 'yes') AS class_code,
  COALESCE(
    NULLIF(btrim(nm_mm.name), ''),
    NULLIF(btrim(nm_en.name), ''),
    NULLIF(btrim(nm_und.name), '')
  ) AS name,
  nm_mm.name AS name_mm,
  nm_en.name AS name_en,
  CASE
    WHEN b.geom IS NULL OR ST_IsEmpty(b.geom) THEN NULL
    ELSE ST_Multi(
      ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(b.geom, 4326))), 3)
    )::geometry(MultiPolygon, 4326)
  END AS geom,
  COALESCE(b.is_active, false) AS is_active,
  b.deleted_at,
  now() AS synced_at
FROM core.core_buildings AS b
LEFT JOIN ref.ref_building_types AS bt
  ON bt.id = b.building_type_id
LEFT JOIN LATERAL (
  SELECT n.name
  FROM core.core_building_names AS n
  WHERE n.building_id = b.id
    AND (lower(btrim(n.language_code)) IN ('mm', 'my')
      OR upper(btrim(coalesce(n.script_code, ''))) = 'MYMR')
  ORDER BY n.is_primary DESC NULLS LAST, n.id
  LIMIT 1
) AS nm_mm ON true
LEFT JOIN LATERAL (
  SELECT n.name
  FROM core.core_building_names AS n
  WHERE n.building_id = b.id
    AND (lower(btrim(n.language_code)) = 'en'
      OR upper(btrim(coalesce(n.script_code, ''))) = 'LATN')
  ORDER BY n.is_primary DESC NULLS LAST, n.id
  LIMIT 1
) AS nm_en ON true
LEFT JOIN LATERAL (
  SELECT n.name
  FROM core.core_building_names AS n
  WHERE n.building_id = b.id
    AND lower(btrim(n.language_code)) = 'und'
  ORDER BY n.is_primary DESC NULLS LAST, n.id
  LIMIT 1
) AS nm_und ON true
WHERE system.pipeline_osm_identity_key(b.external_id) IS NOT NULL
  AND (
    b.deleted_at IS NOT NULL
    OR (b.geom IS NOT NULL AND NOT ST_IsEmpty(b.geom))
  )
