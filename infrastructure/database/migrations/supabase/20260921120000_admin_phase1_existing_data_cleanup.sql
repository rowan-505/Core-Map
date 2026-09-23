-- Admin Phase 1 existing-data cleanup
-- NOT for production apply until disposable validation passes.
-- Geometry of existing rows is never updated.
-- New rows only: Pyay District, Pa Laung SAZ, Wa SAD (union geoms from existing children).

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Identity guards (abort if IDs do not match expected canonical names)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v text;
BEGIN
  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 6674;
  IF v IS DISTINCT FROM 'နန်းယွန်းမြို့နယ်' THEN RAISE EXCEPTION 'ID 6674 identity mismatch: %', v; END IF;

  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 6091;
  IF v IS DISTINCT FROM 'ဆီဆိုင်မြို့နယ်' THEN RAISE EXCEPTION 'ID 6091 identity mismatch: %', v; END IF;

  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 6073;
  IF v IS DISTINCT FROM 'ပင်လောင်းမြို့နယ်' THEN RAISE EXCEPTION 'ID 6073 identity mismatch: %', v; END IF;

  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 6187;
  IF v IS DISTINCT FROM 'ရွာငံမြို့နယ်' THEN RAISE EXCEPTION 'ID 6187 identity mismatch: %', v; END IF;

  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 7139;
  IF v IS DISTINCT FROM 'ပြည်မြို့နယ်' THEN RAISE EXCEPTION 'ID 7139 identity mismatch: %', v; END IF;

  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 6778;
  IF v IS DISTINCT FROM 'ပန်းတောင်းမြို့နယ်' THEN RAISE EXCEPTION 'ID 6778 identity mismatch: %', v; END IF;

  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 7151;
  IF v IS DISTINCT FROM 'ရွှေတောင်မြို့နယ်' THEN RAISE EXCEPTION 'ID 7151 identity mismatch: %', v; END IF;

  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 6115;
  IF v IS NULL OR v NOT LIKE 'ပအိုဝ်း%' THEN RAISE EXCEPTION 'ID 6115 Pa-O mismatch: %', v; END IF;

  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 6192;
  IF v IS NULL OR v NOT LIKE 'ဓနု%' THEN RAISE EXCEPTION 'ID 6192 Danu mismatch: %', v; END IF;

  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 6693;
  IF v IS NULL OR v NOT LIKE 'နာဂ%' THEN RAISE EXCEPTION 'ID 6693 Naga mismatch: %', v; END IF;

  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 6411;
  IF v IS DISTINCT FROM 'ကိုးကန့်' THEN RAISE EXCEPTION 'ID 6411 Kokang mismatch: %', v; END IF;

  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 6329;
  IF v IS DISTINCT FROM 'ရှမ်းပြည်နယ်' THEN RAISE EXCEPTION 'ID 6329 Shan mismatch: %', v; END IF;

  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 6703;
  IF v IS DISTINCT FROM 'စစ်ကိုင်းတိုင်းဒေသကြီး' THEN RAISE EXCEPTION 'ID 6703 Sagaing mismatch: %', v; END IF;

  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 7169;
  IF v IS DISTINCT FROM 'ပဲခူးတိုင်းဒေသကြီး' THEN RAISE EXCEPTION 'ID 7169 Bago mismatch: %', v; END IF;

  -- Reject wrong Hsihseng match
  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 6410;
  IF v IS DISTINCT FROM 'ရှီးရှမ်း‌မြို့နယ်' THEN RAISE EXCEPTION 'ID 6410 unexpected: %', v; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Foreign townships: disable public/official use; keep rows + is_active
-- ---------------------------------------------------------------------------
UPDATE core.core_admin_areas
SET
  address_usage = 'disabled',
  is_public_usable = false,
  is_official_boundary = false,
  verification_status = 'needs_fix',
  is_verified = false,
  boundary_note = COALESCE(boundary_note || ' | ', '') || 'phase1_cleanup:foreign_polygon_disabled',
  updated_at = now()
WHERE id IN (5985, 5986, 6675, 6734, 6735)
  AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2) Create Pyay District under Bago (union of three township geoms; no UPDATE geom)
-- ---------------------------------------------------------------------------
INSERT INTO core.core_admin_areas (
  public_id, parent_id, admin_level_id, admin_area_type_id, canonical_name, slug,
  geom, centroid, source_type_id,
  is_active, is_verified, verification_status,
  boundary_status, is_official_boundary, boundary_confidence_score,
  address_usage, is_public_usable, address_confidence_score,
  boundary_note, geometry_source, reference_source, source_refs, normalized_data
)
SELECT
  'a1000001-0001-4000-8000-000000000001'::uuid,
  7169,
  3, -- district
  7, -- district type
  'ပြည်ခရိုင်',
  'cleanup:pyay-district',
  ST_Multi(ST_CollectionExtract(ST_UnaryUnion(ST_Collect(geom)), 3)),
  ST_PointOnSurface(ST_UnaryUnion(ST_Collect(geom))),
  2, -- manual
  true, false, 'needs_fix',
  'approximate', true, 70,
  'official', true, 50,
  'phase1_cleanup:created_pyay_district_from_township_union',
  'derived_union',
  'phase1_cleanup',
  jsonb_build_object('phase1_cleanup', 'pyay_district', 'source_township_ids', ARRAY[7139,6778,7151]),
  '{}'::jsonb
FROM core.core_admin_areas
WHERE id IN (7139, 6778, 7151);

INSERT INTO core.core_admin_area_names (admin_area_id, name, language_code, name_type, is_primary, search_weight)
SELECT a.id, 'ပြည်ခရိုင်', 'my', 'official', true, 100
FROM core.core_admin_areas a WHERE a.public_id = 'a1000001-0001-4000-8000-000000000001'
UNION ALL
SELECT a.id, 'Pyay District', 'en', 'official', true, 100
FROM core.core_admin_areas a WHERE a.public_id = 'a1000001-0001-4000-8000-000000000001';

UPDATE core.core_admin_areas
SET parent_id = (SELECT id FROM core.core_admin_areas WHERE public_id = 'a1000001-0001-4000-8000-000000000001'),
    updated_at = now()
WHERE id IN (7139, 6778, 7151);

-- ---------------------------------------------------------------------------
-- 3) SAZ parents + proven member townships
-- ---------------------------------------------------------------------------
UPDATE core.core_admin_areas
SET parent_id = 6329, -- Shan
    admin_level_id = 9,
    admin_area_type_id = 5,
    updated_at = now()
WHERE id = 6115;

UPDATE core.core_admin_areas
SET parent_id = 6329,
    admin_level_id = 9,
    admin_area_type_id = 5,
    updated_at = now()
WHERE id = 6192;

UPDATE core.core_admin_areas
SET parent_id = 6703, -- Sagaing
    admin_level_id = 9,
    admin_area_type_id = 5,
    updated_at = now()
WHERE id = 6693;

-- Pa-O members
UPDATE core.core_admin_areas SET parent_id = 6115, updated_at = now() WHERE id IN (6091, 6073, 6310);
-- Danu members
UPDATE core.core_admin_areas SET parent_id = 6192, updated_at = now() WHERE id IN (6187, 6144);
-- Naga members
UPDATE core.core_admin_areas SET parent_id = 6693, updated_at = now() WHERE id IN (6674, 6692, 6699);

-- ---------------------------------------------------------------------------
-- 4) Kokang district -> SAZ (preserve geom)
-- ---------------------------------------------------------------------------
UPDATE core.core_admin_areas
SET
  admin_level_id = 9,
  admin_area_type_id = 5,
  canonical_name = 'ကိုးကန့်ကိုယ်ပိုင်အုပ်ချုပ်ခွင့်ရဒေသ',
  verification_status = 'needs_fix',
  is_verified = false,
  boundary_note = COALESCE(boundary_note || ' | ', '') || 'phase1_cleanup:reclassified_kokang_district_to_saz',
  updated_at = now()
WHERE id = 6411;

-- Ensure Kokang EN primary reflects SAZ (demote conflicting primary if needed later in names section)
UPDATE core.core_admin_area_names
SET name = 'Kokang Self-Administered Zone', is_primary = true, name_type = 'official'
WHERE admin_area_id = 6411 AND language_code = 'en' AND is_primary = true;

UPDATE core.core_admin_area_names
SET name = 'ကိုးကန့်ကိုယ်ပိုင်အုပ်ချုပ်ခွင့်ရဒေသ', is_primary = true, name_type = 'official'
WHERE id = (
  SELECT min(id) FROM core.core_admin_area_names
  WHERE admin_area_id = 6411 AND language_code = 'my' AND is_primary = true
);

-- ---------------------------------------------------------------------------
-- 5) Create Pa Laung SAZ; reparent Namhsan + Mantong
-- ---------------------------------------------------------------------------
INSERT INTO core.core_admin_areas (
  public_id, parent_id, admin_level_id, admin_area_type_id, canonical_name, slug,
  geom, centroid, source_type_id,
  is_active, is_verified, verification_status,
  boundary_status, is_official_boundary, boundary_confidence_score,
  address_usage, is_public_usable, address_confidence_score,
  boundary_note, geometry_source, reference_source, source_refs, normalized_data
)
SELECT
  'a1000001-0001-4000-8000-000000000002'::uuid,
  6329,
  9, 5,
  'ပလောင်ကိုယ်ပိုင်အုပ်ချုပ်ခွင့်ရဒေသ',
  'cleanup:pa-laung-saz',
  ST_Multi(ST_CollectionExtract(ST_UnaryUnion(ST_Collect(geom)), 3)),
  ST_PointOnSurface(ST_UnaryUnion(ST_Collect(geom))),
  2, true, false, 'needs_fix',
  'approximate', true, 70,
  'official', true, 50,
  'phase1_cleanup:created_pa_laung_saz_from_member_union',
  'derived_union', 'phase1_cleanup',
  jsonb_build_object('phase1_cleanup', 'pa_laung_saz', 'source_township_ids', ARRAY[6394,6527]),
  '{}'::jsonb
FROM core.core_admin_areas WHERE id IN (6394, 6527);

INSERT INTO core.core_admin_area_names (admin_area_id, name, language_code, name_type, is_primary, search_weight)
SELECT a.id, 'ပလောင်ကိုယ်ပိုင်အုပ်ချုပ်ခွင့်ရဒေသ', 'my', 'official', true, 100
FROM core.core_admin_areas a WHERE a.public_id = 'a1000001-0001-4000-8000-000000000002'
UNION ALL
SELECT a.id, 'Pa Laung Self-Administered Zone', 'en', 'official', true, 100
FROM core.core_admin_areas a WHERE a.public_id = 'a1000001-0001-4000-8000-000000000002';

UPDATE core.core_admin_areas
SET parent_id = (SELECT id FROM core.core_admin_areas WHERE public_id = 'a1000001-0001-4000-8000-000000000002'),
    updated_at = now()
WHERE id IN (6394, 6527);

-- ---------------------------------------------------------------------------
-- 6) Create Wa SAD; demote Wa North/South from first-level; reclassify descendants
-- ---------------------------------------------------------------------------
INSERT INTO core.core_admin_areas (
  public_id, parent_id, admin_level_id, admin_area_type_id, canonical_name, slug,
  geom, centroid, source_type_id,
  is_active, is_verified, verification_status,
  boundary_status, is_official_boundary, boundary_confidence_score,
  address_usage, is_public_usable, address_confidence_score,
  boundary_note, geometry_source, reference_source, source_refs, normalized_data
)
SELECT
  'a1000001-0001-4000-8000-000000000003'::uuid,
  6329,
  9, 6, -- self_administered_division type
  'ဝကိုယ်ပိုင်အုပ်ချုပ်ခွင့်ရတိုင်း',
  'cleanup:wa-sad',
  ST_Multi(ST_CollectionExtract(ST_UnaryUnion(ST_Collect(geom)), 3)),
  ST_PointOnSurface(ST_UnaryUnion(ST_Collect(geom))),
  2, true, false, 'needs_fix',
  'approximate', true, 70,
  'official', true, 50,
  'phase1_cleanup:created_wa_sad_from_north_south_union',
  'derived_union', 'phase1_cleanup',
  jsonb_build_object('phase1_cleanup', 'wa_sad', 'source_area_ids', ARRAY[6378,6485]),
  '{}'::jsonb
FROM core.core_admin_areas WHERE id IN (6378, 6485);

INSERT INTO core.core_admin_area_names (admin_area_id, name, language_code, name_type, is_primary, search_weight)
SELECT a.id, 'ဝကိုယ်ပိုင်အုပ်ချုပ်ခွင့်ရတိုင်း', 'my', 'official', true, 100
FROM core.core_admin_areas a WHERE a.public_id = 'a1000001-0001-4000-8000-000000000003'
UNION ALL
SELECT a.id, 'Wa Self-Administered Division', 'en', 'official', true, 100
FROM core.core_admin_areas a WHERE a.public_id = 'a1000001-0001-4000-8000-000000000003';

UPDATE core.core_admin_areas
SET
  parent_id = (SELECT id FROM core.core_admin_areas WHERE public_id = 'a1000001-0001-4000-8000-000000000003'),
  admin_level_id = 9,
  admin_area_type_id = 14, -- special_area
  address_usage = 'search_only',
  is_public_usable = false,
  is_official_boundary = false,
  verification_status = 'needs_fix',
  is_verified = false,
  boundary_note = COALESCE(boundary_note || ' | ', '') || 'phase1_cleanup:wa_special_reference_under_sad',
  updated_at = now()
WHERE id IN (6378, 6485);

-- Wa de-facto descendants (exclude foreign 5985/5986 handled above): search_only
WITH RECURSIVE wa AS (
  SELECT id FROM core.core_admin_areas WHERE id IN (6378, 6485)
  UNION ALL
  SELECT c.id FROM core.core_admin_areas c JOIN wa ON c.parent_id = wa.id
  WHERE c.deleted_at IS NULL
)
UPDATE core.core_admin_areas a
SET
  address_usage = CASE WHEN a.id IN (5985, 5986) THEN a.address_usage ELSE 'search_only' END,
  is_public_usable = CASE WHEN a.id IN (5985, 5986) THEN a.is_public_usable ELSE false END,
  is_official_boundary = CASE WHEN a.id IN (5985, 5986) THEN a.is_official_boundary ELSE false END,
  verification_status = CASE WHEN a.id IN (5985, 5986) THEN a.verification_status ELSE 'needs_fix' END,
  is_verified = CASE WHEN a.id IN (5985, 5986) THEN a.is_verified ELSE false END,
  boundary_note = CASE
    WHEN a.id IN (5985, 5986, 6378, 6485) THEN a.boundary_note
    ELSE COALESCE(a.boundary_note || ' | ', '') || 'phase1_cleanup:wa_local_search_only'
  END,
  updated_at = now()
WHERE a.id IN (SELECT id FROM wa)
  AND a.id NOT IN (6378, 6485, 5985, 5986);

-- ---------------------------------------------------------------------------
-- 7) Name cleanup on affected set: one primary per language; Hsihseng EN fix
-- ---------------------------------------------------------------------------
-- Demote duplicate primary names (keep lowest id)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY admin_area_id, language_code
           ORDER BY id
         ) AS rn
  FROM core.core_admin_area_names
  WHERE is_primary = true
    AND language_code IS NOT NULL
    AND admin_area_id IN (
      5985,5986,6675,6734,6735,6091,6073,6187,6674,7139,6778,7151,
      6115,6192,6693,6411,6378,6485,6310,6144,6692,6699,6394,6527,6410,
      6329,6703,7169
    )
)
UPDATE core.core_admin_area_names n
SET is_primary = false,
    name_type = CASE WHEN n.name_type = 'official' THEN 'alias' ELSE n.name_type END
FROM ranked r
WHERE n.id = r.id AND r.rn > 1;

-- Hsihseng (6091): set EN primary to Hsihseng Township; keep Sesai as alias
UPDATE core.core_admin_area_names
SET name = 'Hsihseng Township', is_primary = true, name_type = 'official'
WHERE admin_area_id = 6091 AND language_code = 'en';

INSERT INTO core.core_admin_area_names (admin_area_id, name, language_code, name_type, is_primary, search_weight)
SELECT 6091, 'Sesai Township', 'en', 'alias', false, 40
WHERE NOT EXISTS (
  SELECT 1 FROM core.core_admin_area_names
  WHERE admin_area_id = 6091 AND language_code = 'en' AND name = 'Sesai Township'
);

-- 6410 wrong EN "Hsihseng Township" -> demote and set Shi Shan Township primary
UPDATE core.core_admin_area_names
SET is_primary = false, name_type = 'alias'
WHERE admin_area_id = 6410 AND language_code = 'en' AND name = 'Hsihseng Township';

INSERT INTO core.core_admin_area_names (admin_area_id, name, language_code, name_type, is_primary, search_weight)
SELECT 6410, 'Shi Shan Township', 'en', 'official', true, 100
WHERE NOT EXISTS (
  SELECT 1 FROM core.core_admin_area_names
  WHERE admin_area_id = 6410 AND language_code = 'en' AND name = 'Shi Shan Township'
);

-- Pa-O EN primary ensure
UPDATE core.core_admin_area_names
SET is_primary = true, name_type = 'official'
WHERE admin_area_id = 6115 AND language_code = 'en' AND name ILIKE '%Pa%O%';

COMMIT;
