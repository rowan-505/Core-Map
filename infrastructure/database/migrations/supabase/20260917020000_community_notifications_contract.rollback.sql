-- =============================================================================
-- 20260917020000_community_notifications_contract.rollback.sql
-- Manual rollback companion for 20260917020000_community_notifications_contract.sql
-- Apply only when intentionally rolling back the additive notification contract.
-- Does not wipe community.notifications rows; only reverses schema additions.
-- =============================================================================

BEGIN;

DROP INDEX IF EXISTS community.notifications_user_unread_created_idx;
DROP INDEX IF EXISTS community.notifications_user_event_key_uidx;

ALTER TABLE community.notifications
    DROP COLUMN IF EXISTS event_key;

-- Postgres cannot safely DROP enum values once used. Leave post_reopened and
-- moderation_message on community.notification_type; they are unused after
-- writers stop emitting them. Documented as intentional non-destructive rollback.

COMMIT;
