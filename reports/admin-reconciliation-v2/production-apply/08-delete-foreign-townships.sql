-- Hard-delete 5 foreign townships. Clear nullable FKs first. Do not change other admin rows.
BEGIN;

DO $$
DECLARE
  v text;
BEGIN
  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 5985;
  IF v IS DISTINCT FROM 'อำเภอเวียงแหง' THEN RAISE EXCEPTION 'ID 5985 identity mismatch: %', v; END IF;
  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 5986;
  IF v IS DISTINCT FROM 'อำเภอปางมะผ้า' THEN RAISE EXCEPTION 'ID 5986 identity mismatch: %', v; END IF;
  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 6675;
  IF v IS DISTINCT FROM 'Vijoynagar EAC' THEN RAISE EXCEPTION 'ID 6675 identity mismatch: %', v; END IF;
  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 6734;
  IF v IS DISTINCT FROM 'S'' Bungtlang' THEN RAISE EXCEPTION 'ID 6734 identity mismatch: %', v; END IF;
  SELECT canonical_name INTO v FROM core.core_admin_areas WHERE id = 6735;
  IF v IS DISTINCT FROM 'Tipa' THEN RAISE EXCEPTION 'ID 6735 identity mismatch: %', v; END IF;
END $$;

CREATE TEMP TABLE foreign_tsp(id bigint PRIMARY KEY) ON COMMIT DROP;
INSERT INTO foreign_tsp(id) VALUES (5985),(5986),(6675),(6734),(6735);

-- Clear nullable references
UPDATE core.core_streets SET admin_area_id = NULL, updated_at = now()
WHERE admin_area_id IN (SELECT id FROM foreign_tsp);

UPDATE core.core_places SET admin_area_id = NULL, updated_at = now()
WHERE admin_area_id IN (SELECT id FROM foreign_tsp);

UPDATE core.core_buildings SET admin_area_id = NULL, updated_at = now()
WHERE admin_area_id IN (SELECT id FROM foreign_tsp);

UPDATE core.core_settlements SET township_id = NULL, updated_at = now()
WHERE township_id IN (SELECT id FROM foreign_tsp);

UPDATE transport.stops SET admin_area_id = NULL, updated_at = now()
WHERE admin_area_id IN (SELECT id FROM foreign_tsp);

UPDATE transport.terminals SET admin_area_id = NULL, updated_at = now()
WHERE admin_area_id IN (SELECT id FROM foreign_tsp);

UPDATE core.core_addresses SET admin_area_id = NULL, updated_at = now()
WHERE admin_area_id IN (SELECT id FROM foreign_tsp);

UPDATE core.core_land_areas SET admin_area_id = NULL, updated_at = now()
WHERE admin_area_id IN (SELECT id FROM foreign_tsp);

UPDATE core.core_protected_areas SET admin_area_id = NULL, updated_at = now()
WHERE admin_area_id IN (SELECT id FROM foreign_tsp);

UPDATE transport.infrastructure_lines SET admin_area_id = NULL, updated_at = now()
WHERE admin_area_id IN (SELECT id FROM foreign_tsp);

UPDATE transport.routes SET origin_admin_area_id = NULL, updated_at = now()
WHERE origin_admin_area_id IN (SELECT id FROM foreign_tsp);

UPDATE transport.routes SET destination_admin_area_id = NULL, updated_at = now()
WHERE destination_admin_area_id IN (SELECT id FROM foreign_tsp);

UPDATE app.user_saved_places SET admin_area_id = NULL
WHERE admin_area_id IN (SELECT id FROM foreign_tsp);

UPDATE feedback.user_reports SET admin_area_id = NULL
WHERE admin_area_id IN (SELECT id FROM foreign_tsp);

UPDATE app_auth.auth_users SET primary_region_id = NULL
WHERE primary_region_id IN (SELECT id FROM foreign_tsp);

UPDATE tourism.activities SET admin_area_id = NULL WHERE admin_area_id IN (SELECT id FROM foreign_tsp);
UPDATE tourism.events SET admin_area_id = NULL WHERE admin_area_id IN (SELECT id FROM foreign_tsp);
UPDATE tourism.foods SET admin_area_id = NULL WHERE admin_area_id IN (SELECT id FROM foreign_tsp);
UPDATE tourism.local_guides SET admin_area_id = NULL WHERE admin_area_id IN (SELECT id FROM foreign_tsp);
UPDATE tourism.advisories SET admin_area_id = NULL WHERE admin_area_id IN (SELECT id FROM foreign_tsp);
UPDATE tourism.research_candidates SET admin_area_id = NULL WHERE admin_area_id IN (SELECT id FROM foreign_tsp);

UPDATE ref.ref_postal_codes SET local_admin_area_id = NULL, updated_at = now()
WHERE local_admin_area_id IN (SELECT id FROM foreign_tsp);
UPDATE ref.ref_postal_codes SET township_admin_area_id = NULL, updated_at = now()
WHERE township_admin_area_id IN (SELECT id FROM foreign_tsp);

UPDATE search.address_index SET admin_area_id = NULL
WHERE admin_area_id IN (SELECT id FROM foreign_tsp);

UPDATE search.search_documents SET admin_area_id = NULL
WHERE admin_area_id IN (SELECT id FROM foreign_tsp);

-- Search docs for these admin areas (names cascade)
DELETE FROM search.search_documents
WHERE entity_type = 'admin_area' AND entity_id IN (SELECT id FROM foreign_tsp);

-- No children allowed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM core.core_admin_areas
    WHERE parent_id IN (5985,5986,6675,6734,6735)
  ) THEN
    RAISE EXCEPTION 'foreign townships still have child admin areas';
  END IF;
END $$;

DELETE FROM core.core_admin_area_names WHERE admin_area_id IN (SELECT id FROM foreign_tsp);
DELETE FROM core.core_admin_areas WHERE id IN (SELECT id FROM foreign_tsp);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM core.core_admin_areas WHERE id IN (5985,5986,6675,6734,6735)) THEN
    RAISE EXCEPTION 'foreign townships still present after delete';
  END IF;
END $$;

COMMIT;
