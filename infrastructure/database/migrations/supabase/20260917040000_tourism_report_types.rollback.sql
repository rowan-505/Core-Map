-- Rollback: remove tourism-only report type seed rows.
-- Does not delete historical feedback.user_reports rows that used these codes.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '1min';

DELETE FROM ref.ref_report_types
WHERE code IN (
    'tourism_incorrect_type',
    'tourism_incorrect_description',
    'tourism_incorrect_price',
    'tourism_incorrect_review',
    'tourism_other'
);

COMMIT;
