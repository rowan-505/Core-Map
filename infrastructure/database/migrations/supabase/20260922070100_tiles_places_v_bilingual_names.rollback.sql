-- Rollback: drop bilingual columns from tiles.tiles_places_v (restore prior shape).

CREATE OR REPLACE VIEW tiles.tiles_places_v AS
SELECT
    p.id,
    p.public_id,
    p.display_name,
    p.primary_name,
    p.category_id,
    c.name AS category_name,
    p.importance_score,
    p.is_public,
    p.is_verified,
    p.updated_at,
    p.point_geom AS geom
FROM core.core_places AS p
LEFT JOIN ref.ref_poi_categories AS c
    ON c.id = p.category_id
WHERE p.deleted_at IS NULL
  AND p.is_public = true
  AND p.point_geom IS NOT NULL;
