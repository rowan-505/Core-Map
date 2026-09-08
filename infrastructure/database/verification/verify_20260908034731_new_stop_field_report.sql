-- NEW_STOP field-report contract. Expect: type row exists; no extra table;
-- feedback/ref stay private to anon/authenticated; no SECURITY DEFINER added
-- by this object.

\set ON_ERROR_STOP on

SELECT EXISTS (
    SELECT 1 FROM ref.ref_report_types WHERE code = 'new_stop'
) AS has_new_stop_type;

SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'feedback'
      AND c.relname IN ('field_survey_reports', 'new_stops', 'new_stop_reports')
) AS has_forbidden_table;

-- Expect zero rows: client roles must not read private report/type tables.
SELECT r.role_name, n.nspname, c.relname, p.privilege
FROM (VALUES ('anon'), ('authenticated')) AS r(role_name)
JOIN pg_namespace n ON n.nspname IN ('feedback', 'ref', 'transport')
JOIN pg_class c ON c.relnamespace = n.oid
CROSS JOIN LATERAL (
    VALUES
        ('SELECT', has_table_privilege(r.role_name, c.oid, 'SELECT')),
        ('INSERT', has_table_privilege(r.role_name, c.oid, 'INSERT')),
        ('UPDATE', has_table_privilege(r.role_name, c.oid, 'UPDATE')),
        ('DELETE', has_table_privilege(r.role_name, c.oid, 'DELETE'))
) p(privilege, allowed)
WHERE c.relkind IN ('r', 'p', 'v', 'm')
  AND c.relname IN ('user_reports', 'ref_report_types', 'stops', 'route_stops', 'route_variants')
  AND p.allowed
ORDER BY 1, 2, 3, 4;

SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef
  AND n.nspname IN ('feedback', 'ref')
  AND p.proname ILIKE '%new_stop%';
