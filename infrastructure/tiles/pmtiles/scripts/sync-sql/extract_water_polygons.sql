SELECT
  w.id AS core_id,
  NULL::uuid AS core_public_id,
  w.name,
  COALESCE(
    NULLIF(btrim(w.water_class_code), ''),
    NULLIF(btrim(w.water_class), ''),
    'unknown'
  ) AS class_code,
  ST_Multi(
    ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(w.geom, 4326))), 3)
  )::geometry(MultiPolygon, 4326) AS geom,
  true AS is_active,
  NULL::timestamptz AS deleted_at,
  now() AS synced_at
FROM tiles.tiles_water_polygons_v AS w
WHERE w.geom IS NOT NULL
  AND NOT ST_IsEmpty(w.geom)
