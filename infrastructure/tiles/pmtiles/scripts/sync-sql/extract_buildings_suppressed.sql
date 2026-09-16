SELECT
  feature_key,
  reason,
  created_at,
  created_by,
  now() AS synced_at
FROM core.core_building_render_suppressions
