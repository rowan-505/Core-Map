-- Rollback for 20260921120000_admin_phase1_existing_data_cleanup.sql
-- Restores parents/flags/types for affected existing rows; deletes cleanup-created rows.
-- Does not restore demoted duplicate name rows to primary (safe: aliases preserved).
-- Run only on disposable/local after the forward migration.

BEGIN;

-- Reparent townships away from cleanup-created parents before delete
UPDATE core.core_admin_areas SET parent_id = 7128, updated_at = now() WHERE id = 7139; -- Pyay -> Thayet
UPDATE core.core_admin_areas SET parent_id = 7155, updated_at = now() WHERE id = 6778; -- Padaung -> Myanaung
UPDATE core.core_admin_areas SET parent_id = 7155, updated_at = now() WHERE id = 7151; -- Shwedaung -> Myanaung

UPDATE core.core_admin_areas SET parent_id = 6586, updated_at = now() WHERE id = 6394; -- Namhsan -> Momeik Dist
UPDATE core.core_admin_areas SET parent_id = 6598, updated_at = now() WHERE id = 6527; -- Mantong -> Kutkai Dist

-- Restore Wa North/South under country as state_region/state
UPDATE core.core_admin_areas
SET parent_id = 11,
    admin_level_id = 2,
    admin_area_type_id = 2,
    address_usage = 'official',
    is_public_usable = true,
    is_official_boundary = true,
    verification_status = 'unverified',
    boundary_note = NULLIF(trim(both ' |' from replace(COALESCE(boundary_note,''), 'phase1_cleanup:wa_special_reference_under_sad', '')), ''),
    updated_at = now()
WHERE id IN (6378, 6485);

-- Soft-undo Wa descendant search_only flags (best-effort)
WITH RECURSIVE wa AS (
  SELECT id FROM core.core_admin_areas WHERE id IN (6378, 6485)
  UNION ALL
  SELECT c.id FROM core.core_admin_areas c JOIN wa ON c.parent_id = wa.id
)
UPDATE core.core_admin_areas a
SET
  address_usage = 'official',
  is_public_usable = true,
  is_official_boundary = true,
  boundary_note = NULLIF(trim(both ' |' from replace(COALESCE(boundary_note,''), 'phase1_cleanup:wa_local_search_only', '')), ''),
  updated_at = now()
WHERE a.id IN (SELECT id FROM wa)
  AND a.id NOT IN (6378, 6485, 5985, 5986);

-- Delete names then areas created by cleanup
DELETE FROM core.core_admin_area_names
WHERE admin_area_id IN (
  SELECT id FROM core.core_admin_areas
  WHERE public_id IN (
    'a1000001-0001-4000-8000-000000000001',
    'a1000001-0001-4000-8000-000000000002',
    'a1000001-0001-4000-8000-000000000003'
  )
);

DELETE FROM core.core_admin_areas
WHERE public_id IN (
  'a1000001-0001-4000-8000-000000000001',
  'a1000001-0001-4000-8000-000000000002',
  'a1000001-0001-4000-8000-000000000003'
);

-- Restore SAZ parents + township parents (from pre-migration snapshot)
UPDATE core.core_admin_areas SET parent_id = 6042, updated_at = now() WHERE id = 6115; -- Pa-O -> Zeyathiri
UPDATE core.core_admin_areas SET parent_id = 6197, updated_at = now() WHERE id = 6192; -- Danu -> Kyaukse
UPDATE core.core_admin_areas SET parent_id = 6665, updated_at = now() WHERE id = 6693; -- Naga -> Tanai

UPDATE core.core_admin_areas SET parent_id = 5999, updated_at = now() WHERE id = 6091; -- Hsihseng -> Loikaw
UPDATE core.core_admin_areas SET parent_id = 6042, updated_at = now() WHERE id = 6073; -- Pinlaung -> Zeyathiri
UPDATE core.core_admin_areas SET parent_id = 6176, updated_at = now() WHERE id = 6310; -- Hopong -> Taunggyi
UPDATE core.core_admin_areas SET parent_id = 6197, updated_at = now() WHERE id = 6187; -- Ywangan -> Kyaukse
UPDATE core.core_admin_areas SET parent_id = 6072, updated_at = now() WHERE id = 6144; -- Pindaya
UPDATE core.core_admin_areas SET parent_id = 6665, updated_at = now() WHERE id = 6674; -- Nanyun -> Tanai
UPDATE core.core_admin_areas SET parent_id = 6700, updated_at = now() WHERE id = 6692; -- Lahe
UPDATE core.core_admin_areas SET parent_id = 6700, updated_at = now() WHERE id = 6699; -- Leshi

-- Restore Kokang as district
UPDATE core.core_admin_areas
SET admin_level_id = 3,
    admin_area_type_id = 7,
    canonical_name = 'ကိုးကန့်',
    boundary_note = NULLIF(trim(both ' |' from replace(COALESCE(boundary_note,''), 'phase1_cleanup:reclassified_kokang_district_to_saz', '')), ''),
    updated_at = now()
WHERE id = 6411;

-- Restore foreign flags
UPDATE core.core_admin_areas
SET
  address_usage = 'official',
  is_public_usable = true,
  is_official_boundary = true,
  verification_status = 'unverified',
  boundary_note = NULLIF(trim(both ' |' from replace(COALESCE(boundary_note,''), 'phase1_cleanup:foreign_polygon_disabled', '')), ''),
  updated_at = now()
WHERE id IN (5985, 5986, 6675, 6734, 6735);

-- Best-effort name rollback for 6091 / 6410
UPDATE core.core_admin_area_names
SET name = 'Sesai Township', is_primary = true, name_type = 'official'
WHERE admin_area_id = 6091 AND language_code = 'en' AND name = 'Hsihseng Township';

DELETE FROM core.core_admin_area_names
WHERE admin_area_id = 6091 AND language_code = 'en' AND name = 'Sesai Township' AND is_primary = false;

DELETE FROM core.core_admin_area_names
WHERE admin_area_id = 6410 AND language_code = 'en' AND name = 'Shi Shan Township';

UPDATE core.core_admin_area_names
SET is_primary = true, name_type = 'official'
WHERE admin_area_id = 6410 AND language_code = 'en' AND name = 'Hsihseng Township';

COMMIT;
