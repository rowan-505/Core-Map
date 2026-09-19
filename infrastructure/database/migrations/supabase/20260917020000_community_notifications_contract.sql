-- =============================================================================
-- 20260917020000_community_notifications_contract.sql
-- Additive first-release notification contract for CoreMap Community.
-- Safe to re-run. Does not wipe community data. No Demo Mode objects.
-- =============================================================================

BEGIN;

-- First-release types not present in the initial community contract.
DO $$ BEGIN
    ALTER TYPE community.notification_type ADD VALUE IF NOT EXISTS 'post_reopened';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE community.notification_type ADD VALUE IF NOT EXISTS 'moderation_message';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Stable domain-event key for idempotent create (one event → one notification).
ALTER TABLE community.notifications
    ADD COLUMN IF NOT EXISTS event_key text;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_event_key_uidx
    ON community.notifications (user_id, event_key)
    WHERE event_key IS NOT NULL;

-- Lightweight unread counter path (partial index).
CREATE INDEX IF NOT EXISTS notifications_user_unread_created_idx
    ON community.notifications (user_id, created_at DESC)
    WHERE is_read = false AND deleted_at IS NULL;

COMMIT;
