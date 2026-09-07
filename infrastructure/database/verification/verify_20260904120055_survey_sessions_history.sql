\set ON_ERROR_STOP on

BEGIN;

-- Self-contained fixtures. Everything is rolled back at the end.
INSERT INTO app_auth.auth_users (public_id, email, password_hash, display_name)
VALUES (
    '10000000-0000-4000-8000-000000000001'::uuid,
    'field-session-verification@example.invalid',
    'test-only-not-a-login',
    'Field session verification'
);

WITH route AS (
    INSERT INTO transport.routes (
        public_id, route_code, public_name, mode, route_kind,
        confidence_score, review_status, is_active
    ) VALUES (
        '20000000-0000-4000-8000-000000000001'::uuid,
        'YBS-VERIFY',
        'Field verification route',
        'bus',
        'urban_bus',
        100,
        'verified',
        true
    )
    RETURNING id
)
INSERT INTO transport.route_variants (
    public_id, route_id, variant_code, direction_id,
    origin_name, destination_name, confidence_score, review_status, is_active
)
SELECT
    CASE d.direction_id
        WHEN 0 THEN '30000000-0000-4000-8000-000000000001'::uuid
        ELSE '30000000-0000-4000-8000-000000000002'::uuid
    END,
    route.id,
    format('D%s', d.direction_id),
    d.direction_id,
    CASE d.direction_id WHEN 0 THEN 'Origin' ELSE 'Destination' END,
    CASE d.direction_id WHEN 0 THEN 'Destination' ELSE 'Origin' END,
    100,
    'verified',
    true
FROM route
CROSS JOIN (VALUES (0), (1)) AS d(direction_id);

INSERT INTO ref.ref_report_types (code, name)
VALUES ('other_map_issue', 'Field verification other map issue')
ON CONFLICT (code) DO NOTHING;

INSERT INTO ref.ref_report_statuses (code, name)
VALUES ('submitted', 'Field verification submitted')
ON CONFLICT (code) DO NOTHING;

DO $structure$
DECLARE
    missing_columns text[];
BEGIN
    SELECT array_agg(expected.column_name ORDER BY expected.column_name)
    INTO missing_columns
    FROM (
        VALUES
            ('id', 'bigint', 'NO'),
            ('public_id', 'uuid', 'NO'),
            ('client_session_id', 'uuid', 'NO'),
            ('created_by', 'bigint', 'NO'),
            ('route_variant_id', 'bigint', 'NO'),
            ('snapshot_revision', 'text', 'NO'),
            ('started_at', 'timestamp with time zone', 'NO'),
            ('ended_at', 'timestamp with time zone', 'YES'),
            ('status', 'text', 'NO'),
            ('created_at', 'timestamp with time zone', 'NO'),
            ('updated_at', 'timestamp with time zone', 'NO')
    ) AS expected(column_name, data_type, is_nullable)
    LEFT JOIN information_schema.columns actual
      ON actual.table_schema = 'feedback'
     AND actual.table_name = 'survey_sessions'
     AND actual.column_name = expected.column_name
     AND actual.data_type = expected.data_type
     AND actual.is_nullable = expected.is_nullable
    WHERE actual.column_name IS NULL;

    IF missing_columns IS NOT NULL THEN
        RAISE EXCEPTION 'missing or invalid survey_sessions columns: %', missing_columns;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'media'
          AND table_name = 'assets'
          AND column_name = 'checksum_sha256'
          AND data_type = 'text'
          AND is_nullable = 'YES'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'media.assets'::regclass
          AND conname = 'media_assets_checksum_sha256_chk'
          AND contype = 'c'
    ) THEN
        RAISE EXCEPTION 'media SHA-256 storage or validation constraint is missing';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'feedback'
          AND table_name = 'survey_sessions'
          AND column_name IN ('report_count', 'continuous_gps_trail', 'opposite_variant_id')
    ) THEN
        RAISE EXCEPTION 'forbidden survey_sessions column exists';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'feedback'
          AND c.relname = 'survey_sessions'
          AND c.relrowsecurity
    ) THEN
        RAISE EXCEPTION 'survey_sessions RLS is not enabled';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'feedback'
          AND indexname = 'survey_sessions_created_by_started_at_idx'
          AND indexdef LIKE '%(created_by, started_at DESC)%'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'feedback'
          AND indexname = 'survey_sessions_route_variant_id_idx'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'feedback'
          AND indexname = 'user_reports_survey_session_id_idx'
    ) THEN
        RAISE EXCEPTION 'one or more required survey-session indexes are missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'transport.routes'::regclass
          AND conname = 'routes_public_id_key'
          AND contype = 'u'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'transport.route_variants'::regclass
          AND conname = 'route_variants_public_id_key'
          AND contype = 'u'
    ) THEN
        RAISE EXCEPTION 'transport public ID uniqueness constraints are missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'feedback.survey_sessions'::regclass
          AND conname = 'survey_sessions_created_by_fkey'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'feedback.survey_sessions'::regclass
          AND conname = 'survey_sessions_route_variant_id_fkey'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'feedback.user_reports'::regclass
          AND conname = 'user_reports_survey_session_id_fkey'
    ) THEN
        RAISE EXCEPTION 'one or more required survey-session foreign keys are missing';
    END IF;
END
$structure$;

DO $verify$
DECLARE
    test_user_id bigint;
    test_variant_id bigint;
    session_id bigint;
    zero_report_session_id bigint;
    route_public_id uuid;
    existing_report_count bigint;
    error_seen boolean;
BEGIN
    SELECT id INTO test_user_id FROM app_auth.auth_users ORDER BY id LIMIT 1;
    SELECT id INTO test_variant_id FROM transport.route_variants WHERE direction_id = 0 ORDER BY id LIMIT 1;
    SELECT public_id INTO route_public_id FROM transport.routes WHERE route_code = 'YBS-VERIFY';

    IF test_user_id IS NULL OR test_variant_id IS NULL THEN
        RAISE EXCEPTION 'verification requires one app_auth.auth_users row and one transport.route_variants row';
    END IF;

    SELECT count(*) INTO existing_report_count FROM feedback.user_reports;

    IF (
        SELECT count(*) FROM feedback.user_reports WHERE survey_session_id IS NULL
    ) <> existing_report_count THEN
        RAISE EXCEPTION 'migration linked or invalidated an existing report';
    END IF;

    -- A valid session with no report proves zero-report sessions are supported.
    INSERT INTO feedback.survey_sessions (
        client_session_id,
        created_by,
        route_variant_id,
        snapshot_revision,
        started_at,
        status
    ) VALUES (
        '00000000-0000-4000-8000-000000000001'::uuid,
        test_user_id,
        test_variant_id,
        'verification-snapshot',
        '2026-09-04 00:00:00+00'::timestamptz,
        'active'
    ) RETURNING id INTO session_id;

    IF (SELECT count(*) FROM feedback.user_reports) <> existing_report_count THEN
        RAISE EXCEPTION 'existing report count changed while creating a zero-report session';
    END IF;

    INSERT INTO feedback.survey_sessions (
        client_session_id, created_by, route_variant_id, snapshot_revision, started_at, status
    )
    SELECT
        '00000000-0000-4000-8000-000000000010'::uuid,
        test_user_id,
        id,
        'verification-snapshot',
        '2026-09-04 00:01:00+00'::timestamptz,
        'active'
    FROM transport.route_variants
    WHERE public_id = '30000000-0000-4000-8000-000000000002'::uuid
    RETURNING id INTO zero_report_session_id;

    -- A route-level report needs no stop and remains tied to the exact D0 session.
    INSERT INTO feedback.user_reports (
        public_id, created_by, is_anonymous, eligible_for_points,
        report_type_code, status_code, target_entity_type, target_public_id,
        description, geom, source_code, observed_at, location_accuracy_m,
        report_data, survey_session_id
    ) VALUES (
        '40000000-0000-4000-8000-000000000001'::uuid,
        test_user_id,
        false,
        false,
        'other_map_issue',
        'submitted',
        'route',
        route_public_id,
        'Field verification route report',
        ST_SetSRID(ST_MakePoint(96.20, 16.76), 4326),
        'field_survey',
        '2026-09-04 00:00:30+00'::timestamptz,
        5,
        '{"variantCode":"D0"}'::jsonb,
        session_id
    );

    IF (SELECT count(*) FROM feedback.user_reports WHERE survey_session_id = session_id) <> 1 THEN
        RAISE EXCEPTION 'D0 report count was not derived correctly';
    END IF;
    IF EXISTS (SELECT 1 FROM feedback.user_reports WHERE survey_session_id = zero_report_session_id) THEN
        RAISE EXCEPTION 'D0 report leaked into the D1 zero-report session';
    END IF;

    error_seen := false;
    BEGIN
        INSERT INTO feedback.user_reports (
            public_id, created_by, is_anonymous, eligible_for_points,
            report_type_code, status_code, description, geom,
            source_code, observed_at, report_data, survey_session_id
        ) VALUES (
            '40000000-0000-4000-8000-000000000001'::uuid,
            test_user_id, false, false, 'other_map_issue', 'submitted',
            'Duplicate idempotency key', ST_SetSRID(ST_MakePoint(96.20, 16.76), 4326),
            'field_survey', now(), '{}'::jsonb, session_id
        );
    EXCEPTION WHEN unique_violation THEN
        error_seen := true;
    END;
    IF NOT error_seen THEN RAISE EXCEPTION 'duplicate report public id was accepted'; END IF;

    error_seen := false;
    BEGIN
        INSERT INTO feedback.user_reports (
            public_id, created_by, is_anonymous, eligible_for_points,
            report_type_code, status_code, description, geom,
            source_code, observed_at, report_data, survey_session_id
        ) VALUES (
            '40000000-0000-4000-8000-000000000002'::uuid,
            test_user_id, false, false, 'other_map_issue', 'submitted',
            'Invalid session link', ST_SetSRID(ST_MakePoint(96.20, 16.76), 4326),
            'field_survey', now(), '{}'::jsonb, -9223372036854775808
        );
    EXCEPTION WHEN foreign_key_violation THEN
        error_seen := true;
    END;
    IF NOT error_seen THEN RAISE EXCEPTION 'invalid report session relationship was accepted'; END IF;

    INSERT INTO media.assets (
        public_id, media_type, storage_scope, object_key, mime_type,
        byte_size, checksum_sha256, status, created_by
    ) VALUES (
        '50000000-0000-4000-8000-000000000001'::uuid,
        'image', 'private', 'private/verification.jpg', 'image/jpeg',
        123, repeat('a', 64), 'pending', test_user_id
    );

    error_seen := false;
    BEGIN
        INSERT INTO media.assets (
            public_id, media_type, storage_scope, object_key, mime_type,
            byte_size, checksum_sha256, status, created_by
        ) VALUES (
            '50000000-0000-4000-8000-000000000002'::uuid,
            'image', 'private', 'private/bad-checksum.jpg', 'image/jpeg',
            123, 'not-a-sha256', 'pending', test_user_id
        );
    EXCEPTION WHEN check_violation THEN
        error_seen := true;
    END;
    IF NOT error_seen THEN RAISE EXCEPTION 'invalid media checksum was accepted'; END IF;

    error_seen := false;
    BEGIN
        INSERT INTO feedback.survey_sessions (
            client_session_id, created_by, route_variant_id, snapshot_revision, started_at, status
        ) VALUES (
            '00000000-0000-4000-8000-000000000002'::uuid,
            test_user_id, -9223372036854775808, 'verification-snapshot', now(), 'active'
        );
    EXCEPTION WHEN foreign_key_violation THEN
        error_seen := true;
    END;
    IF NOT error_seen THEN RAISE EXCEPTION 'invalid route variant was accepted'; END IF;

    error_seen := false;
    BEGIN
        INSERT INTO feedback.survey_sessions (
            client_session_id, created_by, route_variant_id, snapshot_revision, started_at, status
        ) VALUES (
            '00000000-0000-4000-8000-000000000001'::uuid,
            test_user_id, test_variant_id, 'verification-snapshot', now(), 'active'
        );
    EXCEPTION WHEN unique_violation THEN
        error_seen := true;
    END;
    IF NOT error_seen THEN RAISE EXCEPTION 'duplicate client_session_id was accepted'; END IF;

    error_seen := false;
    BEGIN
        INSERT INTO feedback.survey_sessions (
            client_session_id, created_by, route_variant_id, snapshot_revision, started_at, status
        ) VALUES (
            '00000000-0000-4000-8000-000000000003'::uuid,
            test_user_id, test_variant_id, 'verification-snapshot', now(), 'paused'
        );
    EXCEPTION WHEN check_violation THEN
        error_seen := true;
    END;
    IF NOT error_seen THEN RAISE EXCEPTION 'invalid status was accepted'; END IF;

    error_seen := false;
    BEGIN
        INSERT INTO feedback.survey_sessions (
            client_session_id, created_by, route_variant_id, snapshot_revision,
            started_at, ended_at, status
        ) VALUES (
            '00000000-0000-4000-8000-000000000004'::uuid,
            test_user_id, test_variant_id, 'verification-snapshot',
            '2026-09-04 01:00:00+00'::timestamptz,
            '2026-09-04 00:59:59+00'::timestamptz,
            'completed'
        );
    EXCEPTION WHEN check_violation THEN
        error_seen := true;
    END;
    IF NOT error_seen THEN RAISE EXCEPTION 'ended_at before started_at was accepted'; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM feedback.survey_sessions WHERE id = session_id
    ) THEN
        RAISE EXCEPTION 'zero-report session did not persist inside verification transaction';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM feedback.user_reports
        WHERE survey_session_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM feedback.survey_sessions s WHERE s.id = survey_session_id
          )
    ) THEN
        RAISE EXCEPTION 'existing report has an invalid survey session reference';
    END IF;
END
$verify$;

-- Direct Supabase client roles must have no access to the new private table.
DO $privileges$
DECLARE
    role_name text;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF has_table_privilege(role_name, 'feedback.survey_sessions', 'SELECT,INSERT,UPDATE,DELETE') THEN
            RAISE EXCEPTION '% unexpectedly has survey_sessions table privileges', role_name;
        END IF;
        IF has_sequence_privilege(role_name, 'feedback.survey_sessions_id_seq', 'USAGE,SELECT,UPDATE') THEN
            RAISE EXCEPTION '% unexpectedly has survey_sessions sequence privileges', role_name;
        END IF;
    END LOOP;
END
$privileges$;

ROLLBACK;

SELECT
    to_regclass('feedback.survey_sessions') IS NOT NULL AS has_survey_sessions,
    EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'feedback'
          AND table_name = 'user_reports'
          AND column_name = 'survey_session_id'
          AND is_nullable = 'YES'
    ) AS has_nullable_report_link,
    (SELECT count(*) FROM feedback.user_reports WHERE survey_session_id IS NOT NULL) AS linked_existing_reports;
