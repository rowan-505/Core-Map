-- Human-approved urgent matches. Run after Phase 2, before search rebuild.
-- Updates names only. Does not change geometry, parents, or official flags.
-- Do not apply to CoreMap 6294 (Mong La) or 6371 (Mong Hsat).

BEGIN;

CREATE TEMP TABLE approved_links (
  core_id bigint PRIMARY KEY,
  name_en text NOT NULL,
  name_my text NOT NULL,
  geom_md5_before text NOT NULL
) ON COMMIT DROP;

INSERT INTO approved_links (core_id, name_en, name_my, geom_md5_before)
SELECT a.id, v.name_en, v.name_my, md5(ST_AsEWKB(a.geom))
FROM core.core_admin_areas a
JOIN (VALUES
  (5974::bigint, 'Bawlake', 'ဘောလခဲခရိုင်'),
  (7444::bigint, 'Kawthoung', 'ကော့သောင်း'),
  (7018::bigint, 'Minbu', 'မင်းဘူး'),
  (7026::bigint, 'Sidoktaya', 'စေတုတ္ထရာ')
) AS v(id, name_en, name_my) ON v.id = a.id;

UPDATE core.core_admin_area_names n
SET is_primary = false, name_type = 'alias'
FROM approved_links a
WHERE n.admin_area_id = a.core_id
  AND n.language_code IN ('en', 'my')
  AND n.is_primary
  AND n.name IS DISTINCT FROM CASE n.language_code WHEN 'en' THEN a.name_en ELSE a.name_my END;

INSERT INTO core.core_admin_area_names
  (admin_area_id, name, language_code, name_type, is_primary, search_weight)
SELECT a.core_id, a.name_en, 'en', 'official', true, 100
FROM approved_links a
WHERE NOT EXISTS (
  SELECT 1 FROM core.core_admin_area_names n
  WHERE n.admin_area_id = a.core_id
    AND n.language_code = 'en'
    AND n.is_primary
    AND n.name = a.name_en
)
UNION ALL
SELECT a.core_id, a.name_my, 'my', 'official', true, 100
FROM approved_links a
WHERE NOT EXISTS (
  SELECT 1 FROM core.core_admin_area_names n
  WHERE n.admin_area_id = a.core_id
    AND n.language_code = 'my'
    AND n.is_primary
    AND n.name = a.name_my
);

UPDATE core.core_admin_areas a
SET canonical_name = l.name_my, updated_at = now()
FROM approved_links l
WHERE a.id = l.core_id
  AND a.canonical_name IS DISTINCT FROM l.name_my;

DO $$
DECLARE
  changed int;
  linked int;
BEGIN
  SELECT count(*) INTO linked FROM approved_links;
  IF linked <> 4 THEN
    RAISE EXCEPTION 'expected 4 approved areas, found %', linked;
  END IF;
  SELECT count(*) INTO changed
  FROM core.core_admin_areas a
  JOIN approved_links l ON l.core_id = a.id
  WHERE md5(ST_AsEWKB(a.geom)) IS DISTINCT FROM l.geom_md5_before;
  IF changed <> 0 THEN
    RAISE EXCEPTION 'geometry changed for % approved rows', changed;
  END IF;
END $$;

COMMIT;
