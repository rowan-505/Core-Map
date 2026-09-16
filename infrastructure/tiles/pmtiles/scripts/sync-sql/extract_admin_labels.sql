SELECT
  a.id AS core_id,
  CASE
    WHEN a.public_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN a.public_id::uuid
    ELSE NULL
  END AS core_public_id,
  a.name,
  a.name_mm,
  a.name_en,
  a.admin_level_code,
  ST_Force2D(ST_SetSRID(a.geom, 4326))::geometry(Point, 4326) AS geom,
  true AS is_active,
  NULL::timestamptz AS deleted_at,
  now() AS synced_at
FROM tiles.tiles_admin_area_label_points_v AS a
WHERE a.geom IS NOT NULL
  AND NOT ST_IsEmpty(a.geom)
  AND GeometryType(ST_Force2D(a.geom)) = 'POINT'
  AND a.admin_level_code IS NOT NULL
