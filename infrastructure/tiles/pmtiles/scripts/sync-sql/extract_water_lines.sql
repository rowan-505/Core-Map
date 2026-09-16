SELECT
  w.id AS core_id,
  NULL::uuid AS core_public_id,
  w.name,
  COALESCE(
    NULLIF(btrim(w.water_class_code), ''),
    NULLIF(btrim(w.waterway_class), ''),
    'unknown'
  ) AS class_code,
  CASE
    WHEN GeometryType(ST_Force2D(w.geom)) = 'LINESTRING'
      THEN ST_Force2D(ST_SetSRID(w.geom, 4326))::geometry(LineString, 4326)
    ELSE ST_GeometryN(
      ST_LineMerge(ST_Force2D(ST_SetSRID(w.geom, 4326))),
      1
    )::geometry(LineString, 4326)
  END AS geom,
  true AS is_active,
  NULL::timestamptz AS deleted_at,
  now() AS synced_at
FROM tiles.tiles_water_lines_v AS w
WHERE w.geom IS NOT NULL
  AND NOT ST_IsEmpty(w.geom)
