-- One-off production cleanup (applied 2026-09-22).
-- Soft-delete 48 agreed test / fake / private-house places.
-- 11 were already hidden. 37 were still public.
-- Matches API/core-review: deleted_at = now(), is_public = false.
-- Does not hard-delete rows. Does not touch generic Pagoda/building names.

BEGIN;

CREATE TEMP TABLE _place_cleanup_20260922 (
    id bigint PRIMARY KEY,
    expected_name text NOT NULL
);

INSERT INTO _place_cleanup_20260922 (id, expected_name) VALUES
    (6, 'Unnamed Place'),
    (11, 'Ko Myo''s house'),
    (13, 'Yulwin''s house'),
    (17, 'Created From API Test'),
    (18, 'test'),
    (19, 'test'),
    (20, 'test'),
    (21, 'Test Placd'),
    (24, 'testing restaurant'),
    (26, 'test en'),
    (131, 'စမ်းသပ်နေရာ'),
    (15485, 'AAAAA'),
    (15501, 'ma may''s house'),
    (15508, 'My House'),
    (15732, 'Moe Moe''s houseo'),
    (15800, 'Moe Moe''s House'),
    (16014, 'Ma myo ''s house'),
    (16335, 'Grandmother''s House'),
    (16810, 'Shennoon''s House'),
    (18617, 'Pho Nyan''s House'),
    (19124, 'Phowa''s house'),
    (19184, 'phyo family''s house'),
    (19652, 'my house 1'),
    (20113, 'Unknown'),
    (79586, 'Bo Thein''s house'),
    (79812, 'U Thar Htun Aung''s house'),
    (80817, 'My house'),
    (80929, 'May ''s house'),
    (81658, '5 Acres Test 1'),
    (82413, 'Yin Htwe''s house'),
    (83226, 'Mom''s House'),
    (83862, 'Naing''s house'),
    (84911, 'Mhwe Che''s house'),
    (86504, 'Moe Y''s house'),
    (88000, 'My House'),
    (89488, 'Jack''s house'),
    (90513, 'Harrison Hong''s house'),
    (95008, 'george orwells house (fake one) - Deputy comissionary house'),
    (102410, 'Place'),
    (109130, 'Chan Myae''s house'),
    (111100, 'Ko Win Shein''s house'),
    (111584, 'Kyan So ( My Mother''s house)'),
    (113335, 'My wife''s house'),
    (113600, 'Daw Khaing''s House'),
    (116107, 'My House'),
    (122554, 'Anonymous House'),
    (124293, 'AS house'),
    (126941, 'Unknown');

DO $$
DECLARE
    missing_count int;
    mismatch_count int;
BEGIN
    SELECT count(*) INTO missing_count
    FROM _place_cleanup_20260922 e
    WHERE NOT EXISTS (SELECT 1 FROM core.core_places p WHERE p.id = e.id);

    IF missing_count <> 0 THEN
        RAISE EXCEPTION 'place cleanup: % expected ids are missing', missing_count;
    END IF;

    SELECT count(*) INTO mismatch_count
    FROM _place_cleanup_20260922 e
    JOIN core.core_places p ON p.id = e.id
    WHERE NOT (
        p.primary_name = e.expected_name
        OR (p.id = 16810 AND p.primary_name ~ '^Shennoon.+House$')
        OR (p.id = 109130 AND p.primary_name LIKE 'Chan Myae''s house%')
    );

    IF mismatch_count <> 0 THEN
        RAISE EXCEPTION 'place cleanup: % ids no longer match expected names', mismatch_count;
    END IF;
END $$;

UPDATE core.core_places AS p
SET
    deleted_at = now(),
    updated_at = now(),
    is_public = false
FROM _place_cleanup_20260922 AS e
WHERE p.id = e.id
  AND p.deleted_at IS NULL
  AND (
      p.primary_name = e.expected_name
      OR (p.id = 16810 AND p.primary_name ~ '^Shennoon.+House$')
      OR (p.id = 109130 AND p.primary_name LIKE 'Chan Myae''s house%')
  );

DELETE FROM search.search_documents AS d
USING _place_cleanup_20260922 AS e
WHERE d.entity_type = 'place'
  AND d.entity_id = e.id;

COMMIT;
