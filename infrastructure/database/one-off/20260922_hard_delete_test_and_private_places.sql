-- Hard-delete the 48 test / fake / private-house places after soft-delete.
-- Child rows first (names, sources). Other FKs were empty.
-- Irreversible.

BEGIN;

CREATE TEMP TABLE _place_hard_delete_20260922 (
    id bigint PRIMARY KEY
);

INSERT INTO _place_hard_delete_20260922 (id) VALUES
    (6), (11), (13), (17), (18), (19), (20), (21), (24), (26), (131),
    (15485), (15501), (15508), (15732), (15800), (16014), (16335), (16810),
    (18617), (19124), (19184), (19652), (20113), (79586), (79812), (80817),
    (80929), (81658), (82413), (83226), (83862), (84911), (86504), (88000),
    (89488), (90513), (95008), (102410), (109130), (111100), (111584),
    (113335), (113600), (116107), (122554), (124293), (126941);

DO $$
DECLARE
    found_count int;
    still_public int;
BEGIN
    SELECT count(*) INTO found_count
    FROM core.core_places p
    JOIN _place_hard_delete_20260922 d ON d.id = p.id;

    IF found_count <> 48 THEN
        RAISE EXCEPTION 'hard delete: expected 48 rows, found %', found_count;
    END IF;

    SELECT count(*) INTO still_public
    FROM core.core_places p
    JOIN _place_hard_delete_20260922 d ON d.id = p.id
    WHERE p.deleted_at IS NULL OR p.is_public;

    IF still_public <> 0 THEN
        RAISE EXCEPTION 'hard delete: % rows are still public or not soft-deleted', still_public;
    END IF;
END $$;

DELETE FROM core.core_place_names AS n
USING _place_hard_delete_20260922 AS d
WHERE n.place_id = d.id;

DELETE FROM core.core_place_sources AS s
USING _place_hard_delete_20260922 AS d
WHERE s.place_id = d.id;

DELETE FROM core.core_places AS p
USING _place_hard_delete_20260922 AS d
WHERE p.id = d.id
  AND p.deleted_at IS NOT NULL
  AND p.is_public = false;

COMMIT;
