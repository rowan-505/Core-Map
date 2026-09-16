SELECT
  c.id AS core_id,
  c.public_id AS core_public_id,
  c.region_code,
  ST_Multi(
    ST_CollectionExtract(ST_Force2D(ST_SetSRID(c.geom, 4326)), 2)
  )::geometry(MultiLineString, 4326) AS geom,
  true AS is_active,
  NULL::timestamptz AS deleted_at,
  now() AS synced_at
FROM tiles.tiles_coastlines_v AS c
WHERE c.geom IS NOT NULL
  AND NOT ST_IsEmpty(c.geom)
