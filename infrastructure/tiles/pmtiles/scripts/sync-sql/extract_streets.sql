SELECT
  s.id AS core_id,
  CASE
    WHEN s.public_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN s.public_id::uuid
    ELSE NULL
  END AS core_public_id,
  NULL::text AS feature_key,
  s.name,
  s.name_mm,
  s.name_en,
  COALESCE(NULLIF(btrim(s.road_class_code), ''), NULLIF(btrim(s.road_class), ''), 'unknown') AS road_class_code,
  COALESCE(s.min_zoom, 12::numeric) AS min_zoom,
  COALESCE(s.sort_rank, 100) AS sort_rank,
  s.surface,
  COALESCE(s.is_oneway, false) AS is_oneway,
  COALESCE(s.bridge, false) AS bridge,
  COALESCE(s.tunnel, false) AS tunnel,
  COALESCE(s.layer, 0) AS layer,
  ST_Force2D(ST_SetSRID(s.geom, 4326))::geometry(LineString, 4326) AS geom,
  true AS is_active,
  NULL::timestamptz AS deleted_at,
  now() AS synced_at
FROM tiles.tiles_streets_v AS s
WHERE s.geom IS NOT NULL
  AND NOT ST_IsEmpty(s.geom)
  AND GeometryType(ST_Force2D(s.geom)) = 'LINESTRING'
