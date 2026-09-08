-- Recovery for 20260908034731. Safe only when no user_reports use new_stop.
-- Do not run against production from this prompt.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '1min';

DO $guard$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM feedback.user_reports
        WHERE report_type_code = 'new_stop'
    ) THEN
        RAISE EXCEPTION 'Cannot drop new_stop while user_reports rows still use it';
    END IF;
END
$guard$;

DELETE FROM ref.ref_report_types
WHERE code = 'new_stop';

COMMIT;
