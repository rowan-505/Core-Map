-- Restore bilingual name_mm / name_en on tiles.tiles_places_v for MapLibre language mode.
-- Must DROP first: CREATE OR REPLACE cannot reorder/insert columns mid-view.

CREATE SCHEMA IF NOT EXISTS tiles;

DROP VIEW IF EXISTS tiles.tiles_places_v;

CREATE VIEW tiles.tiles_places_v AS
SELECT
    p.id,
    p.public_id,
    p.display_name,
    p.primary_name,
    mm.name AS name_mm,
    en.name AS name_en,
    p.category_id,
    c.code AS category,
    c.name AS category_name,
    p.importance_score,
    p.is_public,
    p.is_verified,
    p.updated_at,
    p.point_geom AS geom
FROM core.core_places AS p
LEFT JOIN ref.ref_poi_categories AS c
    ON c.id = p.category_id
LEFT JOIN LATERAL (
    SELECT pn.name
    FROM core.core_place_names AS pn
    WHERE pn.place_id = p.id
      AND (
          pn.language_code IN ('my', 'mm')
          OR upper(trim(coalesce(pn.script_code, ''))) = 'MYMR'
      )
    ORDER BY
        CASE
            WHEN pn.name_type = 'official' AND pn.is_primary = true THEN 1
            WHEN pn.is_primary = true THEN 2
            WHEN pn.name_type = 'official' THEN 3
            ELSE 4
        END,
        pn.search_weight DESC NULLS LAST,
        pn.name ASC
    LIMIT 1
) AS mm ON true
LEFT JOIN LATERAL (
    SELECT pn.name
    FROM core.core_place_names AS pn
    WHERE pn.place_id = p.id
      AND (
          pn.language_code = 'en'
          OR upper(trim(coalesce(pn.script_code, ''))) = 'LATN'
      )
    ORDER BY
        CASE
            WHEN pn.name_type = 'official' AND pn.is_primary = true THEN 1
            WHEN pn.is_primary = true THEN 2
            WHEN pn.name_type = 'official' THEN 3
            ELSE 4
        END,
        pn.search_weight DESC NULLS LAST,
        pn.name ASC
    LIMIT 1
) AS en ON true
WHERE p.deleted_at IS NULL
  AND p.is_public = true
  AND p.point_geom IS NOT NULL
  AND NOT st_isempty(p.point_geom)
  AND st_isvalid(p.point_geom);

COMMENT ON VIEW tiles.tiles_places_v IS
    'Public POI tile source with name_mm / name_en for MapLibre languageMode text-field.';
