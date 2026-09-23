-- Verification for ref.ref_postal_codes after postal_import.py apply
-- Expect all assertions to pass.

DO $$
DECLARE
  v_count bigint;
  v_dupes bigint;
  v_invalid bigint;
  v_null_status bigint;
  v_dead_fk bigint;
  v_mismatch bigint;
BEGIN
  SELECT count(*) INTO v_count FROM ref.ref_postal_codes;
  IF v_count <> 17297 THEN
    RAISE EXCEPTION 'expected 17297 postal rows, got %', v_count;
  END IF;

  SELECT count(*) INTO v_dupes FROM (
    SELECT postal_code FROM ref.ref_postal_codes GROUP BY postal_code HAVING count(*) > 1
  ) s;
  IF v_dupes <> 0 THEN
    RAISE EXCEPTION 'duplicate postal codes: %', v_dupes;
  END IF;

  SELECT count(*) INTO v_invalid
  FROM ref.ref_postal_codes WHERE postal_code !~ '^[0-9]{7}$';
  IF v_invalid <> 0 THEN
    RAISE EXCEPTION 'invalid postal codes: %', v_invalid;
  END IF;

  SELECT count(*) INTO v_null_status
  FROM ref.ref_postal_codes WHERE match_status IS NULL OR btrim(match_status) = '';
  IF v_null_status <> 0 THEN
    RAISE EXCEPTION 'rows missing match_status: %', v_null_status;
  END IF;

  SELECT count(*) INTO v_dead_fk
  FROM ref.ref_postal_codes p
  WHERE (p.township_admin_area_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM core.core_admin_areas a
          WHERE a.id = p.township_admin_area_id AND a.deleted_at IS NULL AND a.is_active
        ))
     OR (p.local_admin_area_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM core.core_admin_areas a
          WHERE a.id = p.local_admin_area_id AND a.deleted_at IS NULL AND a.is_active
        ));
  IF v_dead_fk <> 0 THEN
    RAISE EXCEPTION 'dead FKs: %', v_dead_fk;
  END IF;

  SELECT count(*) INTO v_mismatch
  FROM ref.ref_postal_codes p
  WHERE p.local_admin_area_id IS NOT NULL
    AND p.township_admin_area_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM (
        WITH RECURSIVE chain AS (
          SELECT id, parent_id, 0 AS depth
          FROM core.core_admin_areas WHERE id = p.local_admin_area_id
          UNION ALL
          SELECT a.id, a.parent_id, chain.depth + 1
          FROM core.core_admin_areas a
          JOIN chain ON a.id = chain.parent_id
          WHERE chain.depth < 20
        )
        SELECT id FROM chain WHERE id = p.township_admin_area_id
      ) hit
    );
  IF v_mismatch <> 0 THEN
    RAISE EXCEPTION 'local/township hierarchy mismatches: %', v_mismatch;
  END IF;

  RAISE NOTICE 'ref.ref_postal_codes verification passed';
END $$;
