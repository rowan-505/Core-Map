SELECT
  p.id AS core_id,
  p.public_id AS core_public_id,
  NULL::text AS feature_key,
  COALESCE(NULLIF(btrim(p.protected_area_class_code), ''), 'unknown') AS class_code,
  p.name,
  NULL::text AS name_mm,
  NULL::text AS name_en,
  ST_Multi(
    ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(p.geom, 4326))), 3)
  )::geometry(MultiPolygon, 4326) AS geom,
  true AS is_active,
  NULL::timestamptz AS deleted_at,
  now() AS synced_at
FROM tiles.tiles_protected_areas_v AS p
WHERE p.geom IS NOT NULL
  AND NOT ST_IsEmpty(p.geom)
