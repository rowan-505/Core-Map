-- Rollback: 20260917100000_place_activity_daily_drop_duplicate_uidx.sql
-- Recreates the redundant unique index (not recommended).

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE UNIQUE INDEX IF NOT EXISTS place_activity_daily_place_date_uidx
    ON app.place_activity_daily (place_id, activity_date);

COMMIT;
