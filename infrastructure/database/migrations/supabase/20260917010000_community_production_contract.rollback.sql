-- =============================================================================
-- MANUAL ROLLBACK companion for 20260917010000_community_production_contract.sql
-- -----------------------------------------------------------------------------
-- Project convention: forward-only SQL migrations. This file is NOT applied by
-- default. Use only on disposable/local databases to reverse a test apply.
--
-- Effects:
--   * Restores legacy single `community.post_status` column from the new
--     publication_status + verification_status pair.
--   * Restores legacy reaction labels (helpful→useful, incorrect→fake).
--   * Drops moderation history and new helper columns.
--   * Does NOT recreate Demo Mode objects.
--   * Does NOT touch feedback / app_auth / core.
-- =============================================================================

BEGIN;

-- Recreate legacy enums if needed.
DO $$ BEGIN
    CREATE TYPE community.post_status AS ENUM (
        'free_board',
        'community_confirmed',
        'admin_verified',
        'rejected',
        'resolved',
        'expired'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE community.reaction_type_legacy AS ENUM (
        'confirm',
        'useful',
        'fake',
        'resolved'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE community.community_posts
    ADD COLUMN IF NOT EXISTS status community.post_status;

UPDATE community.community_posts
SET status = CASE
    WHEN publication_status = 'rejected' THEN 'rejected'::community.post_status
    WHEN publication_status = 'resolved' THEN 'resolved'::community.post_status
    WHEN publication_status = 'expired' THEN 'expired'::community.post_status
    WHEN publication_status = 'removed' THEN 'rejected'::community.post_status
    WHEN verification_status = 'admin_verified' THEN 'admin_verified'::community.post_status
    WHEN verification_status = 'community_confirmed' THEN 'community_confirmed'::community.post_status
    ELSE 'free_board'::community.post_status
END
WHERE status IS NULL;

ALTER TABLE community.community_posts
    ALTER COLUMN status SET DEFAULT 'free_board',
    ALTER COLUMN status SET NOT NULL;

-- Detach new reaction enum → legacy labels.
ALTER TABLE community.notifications
    ALTER COLUMN reaction_type TYPE text
    USING (
        CASE reaction_type::text
            WHEN 'helpful' THEN 'useful'
            WHEN 'incorrect' THEN 'fake'
            WHEN 'confirm' THEN 'confirm'
            ELSE NULL
        END
    );

ALTER TABLE community.post_reactions
    ALTER COLUMN reaction_type TYPE text
    USING (
        CASE reaction_type::text
            WHEN 'helpful' THEN 'useful'
            WHEN 'incorrect' THEN 'fake'
            WHEN 'confirm' THEN 'confirm'
            ELSE 'confirm'
        END
    );

DROP TABLE IF EXISTS community.post_moderation_events;

ALTER TABLE community.community_posts
    DROP COLUMN IF EXISTS publication_status,
    DROP COLUMN IF EXISTS verification_status,
    DROP COLUMN IF EXISTS location,
    DROP COLUMN IF EXISTS location_label,
    DROP COLUMN IF EXISTS published_at,
    DROP COLUMN IF EXISTS deleted_at;

ALTER TABLE community.notifications
    DROP COLUMN IF EXISTS deleted_at;

DROP TYPE IF EXISTS community.publication_status;
DROP TYPE IF EXISTS community.verification_status;
DROP TYPE IF EXISTS community.reaction_type;
DROP TYPE IF EXISTS community.reaction_type_v2;

ALTER TYPE community.reaction_type_legacy RENAME TO reaction_type;

ALTER TABLE community.post_reactions
    ALTER COLUMN reaction_type TYPE community.reaction_type
    USING reaction_type::community.reaction_type;

ALTER TABLE community.notifications
    ALTER COLUMN reaction_type TYPE community.reaction_type
    USING CASE
        WHEN reaction_type IS NULL THEN NULL
        ELSE reaction_type::community.reaction_type
    END;

CREATE INDEX IF NOT EXISTS community_posts_status_idx
    ON community.community_posts (status);

COMMIT;
