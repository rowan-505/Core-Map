\set ON_ERROR_STOP on
\timing on

BEGIN;

INSERT INTO app_auth.auth_users (public_id, email, password_hash, display_name)
SELECT gen_random_uuid(),
       format('field-hardening-%s@example.invalid', n),
       'test-only-not-a-login',
       format('Field hardening surveyor %s', n)
FROM generate_series(1, 10) AS n;

INSERT INTO transport.routes (
    public_id, route_code, public_name, mode, route_kind,
    confidence_score, review_status, is_active
)
SELECT gen_random_uuid(),
       format('YBS-HARDENING-%s', n),
       format('Field hardening route %s', n),
       'bus',
       'urban_bus',
       100,
       'verified',
       true
FROM generate_series(1, 25000) AS n;

INSERT INTO transport.route_variants (
    public_id, route_id, variant_code, direction_id, origin_name,
    destination_name, confidence_score, review_status, is_active
)
SELECT gen_random_uuid(),
       r.id,
       format('D%s', d.direction_id),
       d.direction_id,
       format('Origin %s', r.id),
       format('Destination %s', r.id),
       100,
       'verified',
       true
FROM transport.routes r
CROSS JOIN (VALUES (0), (1)) AS d(direction_id)
WHERE r.route_code LIKE 'YBS-HARDENING-%';

SELECT v.public_id AS target_variant_public_id
FROM transport.route_variants v
JOIN transport.routes r ON r.id = v.route_id
WHERE r.route_code = 'YBS-HARDENING-1'
  AND v.direction_id = 0
\gset

SELECT u.id AS target_user_id
FROM app_auth.auth_users u
WHERE u.email = 'field-hardening-1@example.invalid'
\gset

INSERT INTO feedback.survey_sessions (
    client_session_id, created_by, route_variant_id, snapshot_revision,
    started_at, ended_at, status
)
SELECT md5(format('field-hardening-session-%s', n))::uuid,
       u.id,
       v.id,
       'field-hardening-snapshot',
       clock_timestamp() - make_interval(secs => n),
       CASE WHEN n % 3 = 0 THEN clock_timestamp() ELSE NULL END,
       CASE WHEN n % 3 = 0 THEN 'completed' ELSE 'active' END
FROM generate_series(1, 10000) AS n
JOIN LATERAL (
    SELECT id
    FROM app_auth.auth_users
    WHERE email = format('field-hardening-%s@example.invalid', ((n - 1) % 10) + 1)
) u ON true
JOIN LATERAL (
    SELECT v.id
    FROM transport.route_variants v
    JOIN transport.routes r ON r.id = v.route_id
    WHERE r.route_code = format('YBS-HARDENING-%s', ((n - 1) % 25000) + 1)
      AND v.direction_id = n % 2
) v ON true;

INSERT INTO ref.ref_report_types (code, name)
VALUES ('other_map_issue', 'Field hardening other map issue')
ON CONFLICT (code) DO NOTHING;

INSERT INTO ref.ref_report_statuses (code, name)
VALUES ('submitted', 'Field hardening submitted')
ON CONFLICT (code) DO NOTHING;

INSERT INTO feedback.user_reports (
    public_id, created_by, is_anonymous, eligible_for_points,
    report_type_code, status_code, target_entity_type, target_public_id,
    description, geom, source_code, observed_at, location_accuracy_m,
    report_data, survey_session_id
)
SELECT md5(format('field-hardening-report-%s-%s', ss.id, report_number))::uuid,
       ss.created_by,
       false,
       false,
       'other_map_issue',
       'submitted',
       'route',
       r.public_id,
       'Synthetic field hardening report',
       ST_SetSRID(ST_MakePoint(96.20, 16.76), 4326),
       'field_survey',
       ss.started_at,
       5,
       jsonb_build_object('variantCode', format('D%s', v.direction_id)),
       ss.id
FROM feedback.survey_sessions ss
JOIN transport.route_variants v ON v.id = ss.route_variant_id
JOIN transport.routes r ON r.id = v.route_id
CROSS JOIN generate_series(1, 2) AS report_number
WHERE ss.snapshot_revision = 'field-hardening-snapshot';

ANALYZE app_auth.auth_users;
ANALYZE transport.routes;
ANALYZE transport.route_variants;
ANALYZE feedback.survey_sessions;
ANALYZE feedback.user_reports;

\echo 'FIELD_EXPLAIN active variant by public id'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT v.id, v.public_id, r.public_id, r.route_code, v.direction_id
FROM transport.route_variants v
JOIN transport.routes r ON r.id = v.route_id
WHERE v.public_id = :'target_variant_public_id'::uuid
  AND v.deleted_at IS NULL
  AND v.is_active = true
  AND v.direction_id IN (0, 1)
  AND coalesce(v.review_status, '') IS DISTINCT FROM 'rejected'
  AND r.deleted_at IS NULL
  AND r.is_active = true
  AND r.mode = 'bus'
  AND r.route_code LIKE 'YBS-%'
  AND coalesce(r.review_status, '') IS DISTINCT FROM 'rejected'
LIMIT 1;

\echo 'FIELD_EXPLAIN route target by public id'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT r.id
FROM transport.routes r
WHERE r.public_id = (
    SELECT r2.public_id
    FROM transport.routes r2
    WHERE r2.route_code = 'YBS-HARDENING-1'
    LIMIT 1
)
  AND r.deleted_at IS NULL
LIMIT 1;

\echo 'FIELD_EXPLAIN session history with report counts and cursor ordering'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT ss.id, ss.public_id, ss.started_at,
       (SELECT count(*)
        FROM feedback.user_reports ur
        WHERE ur.survey_session_id = ss.id) AS report_count
FROM feedback.survey_sessions ss
WHERE ss.created_by = :'target_user_id'::bigint
ORDER BY ss.started_at DESC, ss.public_id DESC
LIMIT 51;

\echo 'FIELD_EXPLAIN report count by survey session'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT count(*)
FROM feedback.user_reports ur
WHERE ur.survey_session_id = (
    SELECT id
    FROM feedback.survey_sessions
    WHERE created_by = :'target_user_id'::bigint
    ORDER BY started_at DESC
    LIMIT 1
);

ROLLBACK;
