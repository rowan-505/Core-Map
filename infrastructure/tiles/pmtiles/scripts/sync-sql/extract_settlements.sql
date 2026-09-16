SELECT
  s.id AS core_id,
  s.public_id AS core_public_id,
  s.settlement_type,
  s.name,
  s.name_mm,
  s.name_en,
  s.importance_score,
  COALESCE(s.min_zoom, 12::numeric) AS min_zoom,
  ST_Force2D(ST_SetSRID(s.geom, 4326))::geometry(Point, 4326) AS geom,
  true AS is_active,
  NULL::timestamptz AS deleted_at,
  now() AS synced_at
FROM tiles.tiles_settlements_v AS s
WHERE s.geom IS NOT NULL
  AND NOT ST_IsEmpty(s.geom)
  AND GeometryType(ST_Force2D(s.geom)) = 'POINT'
