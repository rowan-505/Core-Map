SELECT
  system.pipeline_osm_identity_key(l.external_id) AS feature_key,
  l.id AS core_id,
  l.public_id AS core_public_id,
  COALESCE(NULLIF(btrim(lc.code), ''), 'unknown') AS class_code,
  COALESCE(
    NULLIF(btrim(l.name), ''),
    NULLIF(btrim(lc.name_en), ''),
    NULLIF(btrim(lc.name_mm), '')
  ) AS name,
  lc.name_mm AS name_mm,
  lc.name_en AS name_en,
  CASE
    WHEN l.geom IS NULL OR ST_IsEmpty(l.geom) THEN NULL
    ELSE ST_Multi(
      ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(l.geom, 4326))), 3)
    )::geometry(MultiPolygon, 4326)
  END AS geom,
  COALESCE(l.is_active, false) AS is_active,
  l.deleted_at,
  now() AS synced_at
FROM core.core_land_areas AS l
LEFT JOIN ref.ref_land_area_classes AS lc
  ON lc.id = l.land_area_class_id
WHERE system.pipeline_osm_identity_key(l.external_id) IS NOT NULL
  AND (
    l.deleted_at IS NOT NULL
    OR (l.geom IS NOT NULL AND NOT ST_IsEmpty(l.geom))
  )
