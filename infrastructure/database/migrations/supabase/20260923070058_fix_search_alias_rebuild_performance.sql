-- =============================================================================
-- Fix search rebuild alias folding performance
-- =============================================================================
--
-- The rebuild function used apply_search_aliases_for_documents(NULL, ids).
-- That helper reloads a source view once per document. For street_groups this
-- repeatedly scans and groups the national street table, turning a small
-- grouped rebuild into an effectively unbounded N+1 query.
--
-- During a rebuild, canonical searchable_text is already present on the newly
-- inserted documents and old names were removed by the document replacement.
-- Fold active aliases directly from tmp_search_src in set-based statements.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE OR REPLACE FUNCTION search.apply_search_aliases_from_temp_source()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public, extensions, core, ref, system,
    import_review, search, transport, routing, tiles, app_auth
AS $function$
DECLARE
    v_names_added integer := 0;
    v_docs_updated integer := 0;
BEGIN
    IF to_regclass('pg_temp.tmp_search_src') IS NULL THEN
        RAISE EXCEPTION 'tmp_search_src is required for rebuild alias folding';
    END IF;

    EXECUTE $sql$
        WITH target_aliases AS (
            SELECT DISTINCT
                t.entity_type,
                t.entity_id,
                a.language_code,
                a.alias_text,
                a.normalized_alias,
                a.alias_type
            FROM pg_temp.tmp_search_src t
            INNER JOIN search.search_aliases a
                ON a.entity_type = t.entity_type
               AND a.entity_id = t.entity_id
               AND a.is_active
        ),
        inserted AS (
            INSERT INTO search.search_document_names (
                search_document_id,
                language_code,
                script_code,
                name,
                normalized_name,
                name_type,
                is_primary,
                search_weight
            )
            SELECT
                d.id,
                COALESCE(NULLIF(btrim(a.language_code), ''), 'und'),
                NULL,
                a.alias_text,
                a.normalized_alias,
                a.alias_type,
                false,
                LEAST(100, GREATEST(0, search.search_alias_weight(a.alias_type)))
            FROM target_aliases a
            INNER JOIN search.search_documents d
                ON d.entity_type = a.entity_type
               AND d.entity_id = a.entity_id
            WHERE NOT EXISTS (
                SELECT 1
                FROM search.search_document_names n
                WHERE n.search_document_id = d.id
                  AND n.normalized_name = a.normalized_alias
                  AND n.language_code =
                      COALESCE(NULLIF(btrim(a.language_code), ''), 'und')
            )
            RETURNING 1
        )
        SELECT count(*)::integer
        FROM inserted
    $sql$
    INTO v_names_added;

    EXECUTE $sql$
        WITH target_ids AS (
            SELECT DISTINCT t.entity_type, t.entity_id
            FROM pg_temp.tmp_search_src t
        ),
        alias_texts AS (
            SELECT
                t.entity_type,
                t.entity_id,
                string_agg(DISTINCT a.alias_text, ' ' ORDER BY a.alias_text)
                    AS alias_text
            FROM target_ids t
            INNER JOIN search.search_aliases a
                ON a.entity_type = t.entity_type
               AND a.entity_id = t.entity_id
               AND a.is_active
            GROUP BY t.entity_type, t.entity_id
        ),
        merged AS (
            SELECT
                d.id,
                NULLIF(
                    btrim(concat_ws(' ', d.searchable_text, a.alias_text)),
                    ''
                ) AS searchable_text
            FROM alias_texts a
            INNER JOIN search.search_documents d
                ON d.entity_type = a.entity_type
               AND d.entity_id = a.entity_id
        )
        UPDATE search.search_documents d
        SET searchable_text = m.searchable_text,
            trigram_text = NULLIF(lower(m.searchable_text), ''),
            indexed_at = now()
        FROM merged m
        WHERE d.id = m.id
          AND m.searchable_text IS DISTINCT FROM d.searchable_text
    $sql$;

    GET DIAGNOSTICS v_docs_updated = ROW_COUNT;

    RETURN jsonb_build_object(
        'names_added', v_names_added,
        'documents_updated', v_docs_updated
    );
END;
$function$;

COMMENT ON FUNCTION search.apply_search_aliases_from_temp_source() IS
    'Set-based alias folding for rebuild_search_documents using its current tmp_search_src.';

DO $block$
DECLARE
    old_def text;
    new_def text;
BEGIN
    IF to_regprocedure('search.rebuild_search_documents(text[])') IS NULL THEN
        RAISE EXCEPTION 'search.rebuild_search_documents(text[]) is missing';
    END IF;

    old_def := pg_get_functiondef(
        'search.rebuild_search_documents(text[])'::regprocedure
    );

    new_def := regexp_replace(
        old_def,
        'search[.]apply_search_aliases_for_documents[(][[:space:]]*null,[[:space:]]*[(]select array_agg[(]distinct t[.]entity_id[)] from tmp_search_src t[)][[:space:]]*[)]',
        'search.apply_search_aliases_from_temp_source()',
        'g'
    );

    IF new_def = old_def THEN
        RAISE EXCEPTION
            'Expected rebuild alias-folding call was not found; migration not applied';
    END IF;

    EXECUTE new_def;

    IF pg_get_functiondef(
        'search.rebuild_search_documents(text[])'::regprocedure
    ) ILIKE '%apply_search_aliases_for_documents(%tmp_search_src%' THEN
        RAISE EXCEPTION 'Per-document rebuild alias folding still remains';
    END IF;
END
$block$;

COMMIT;

-- Deliberate post-deploy operations (run one family at a time):
--   SET statement_timeout = '30min';
--   SELECT search.rebuild_search_documents(ARRAY['street_groups']);
--   SELECT search.rebuild_search_documents(ARRAY['settlements']);
