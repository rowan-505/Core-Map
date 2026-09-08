-- Additive NEW_STOP field-report type. Evidence only: no canonical stop insert
-- and no route_stops sequence rewrite.
-- Reuses feedback.user_reports.report_data JSON (migration 203).
-- Does not GRANT anon/authenticated. Does not add SECURITY DEFINER.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '1min';

INSERT INTO ref.ref_report_types (code, name)
VALUES ('new_stop', 'New stop')
ON CONFLICT (code) DO NOTHING;

COMMENT ON COLUMN feedback.user_reports.report_data IS
    'Bounded JSON object. Field survey stores snapshotRevision, routePublicId, '
    'variantPublicId, variantCode (D0/D1), stopPublicId, stopSequence, '
    'canonicalSnapshot, and for new_stop: previousStopPublicId, previousStopSequence, '
    'nextStopPublicId, proposedStopName, locationSource (GPS|MAP_PICK). '
    'Not a substitute for geom. Never writes transport.stops or route_stops.';

COMMIT;
