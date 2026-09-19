-- Rollback for 20260917070000_tourism_ranking_configs.sql
BEGIN;

DROP INDEX IF EXISTS tourism.ranking_configs_version_idx;
DROP INDEX IF EXISTS tourism.ranking_configs_active_scope_uidx;
DROP TABLE IF EXISTS tourism.ranking_configs;

COMMIT;
