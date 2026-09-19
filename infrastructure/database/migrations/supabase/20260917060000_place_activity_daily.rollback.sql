-- Rollback for 20260917060000_place_activity_daily.sql
BEGIN;

DROP INDEX IF EXISTS app.place_activity_daily_place_date_desc_idx;
DROP INDEX IF EXISTS app.place_activity_daily_date_idx;
DROP INDEX IF EXISTS app.place_activity_daily_place_date_uidx;
DROP TABLE IF EXISTS app.place_activity_daily;

COMMIT;
