-- =============================================================================
-- 20260917010000_community_production_contract.sql
-- -----------------------------------------------------------------------------
-- Production contract for CoreMap Community posts + in-app notifications.
--
-- Goals:
--   * Normalize legacy single `post_status` into publication + verification.
--   * Normalize reactions to confirm / helpful / incorrect (no resolved reaction).
--   * Preserve existing community rows (map, do not wipe).
--   * Add soft-delete, published_at cursor support, optional Point location,
--     and append-only moderation history.
--   * Reuse app_auth.auth_users only — no community auth/user/session tables.
--   * Keep feedback / map / survey report tables untouched.
--   * No Demo Mode objects.
--
-- Safe properties:
--   * Additive / transformational; never DROP SCHEMA community.
--   * Never DROP / TRUNCATE community tables wholesale.
--   * Idempotent guards so re-apply on an already-normalized DB is a no-op.
--   * RLS stays enabled (no anon/authenticated policies) for API-only access.
--
-- Pre-requisites:
--   * app_auth.auth_users exists.
--   * postgis available when location column is used (CREATE EXTENSION IF NOT EXISTS).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS community;

-- ----------------------------------------------------------------------------
-- 1. New enums (idempotent)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE community.publication_status AS ENUM (
        'published',
        'resolved',
        'expired',
        'rejected',
        'removed'
    );
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE community.verification_status AS ENUM (
        'unverified',
        'community_confirmed',
        'admin_verified'
    );
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- Keep notification_type values already present in prod; add preferred ones.
DO $$ BEGIN
    CREATE TYPE community.notification_type AS ENUM (
        'community_confirmed',
        'admin_verified',
        'rejected',
        'resolved',
        'expired',
        'post_reaction',
        'post_community_confirmed',
        'post_admin_verified',
        'post_admin_unverified',
        'post_rejected',
        'post_resolved',
        'post_expired'
    );
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE community.notification_type ADD VALUE IF NOT EXISTS 'post_reaction';
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TYPE community.notification_type ADD VALUE IF NOT EXISTS 'post_community_confirmed';
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TYPE community.notification_type ADD VALUE IF NOT EXISTS 'post_admin_verified';
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TYPE community.notification_type ADD VALUE IF NOT EXISTS 'post_admin_unverified';
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TYPE community.notification_type ADD VALUE IF NOT EXISTS 'post_rejected';
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TYPE community.notification_type ADD VALUE IF NOT EXISTS 'post_resolved';
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TYPE community.notification_type ADD VALUE IF NOT EXISTS 'post_expired';
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Ensure community_posts exists (final shape for greenfield)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community.community_posts (
    id                   bigserial PRIMARY KEY,
    public_id            uuid        NOT NULL DEFAULT gen_random_uuid(),
    author_id            bigint      NOT NULL,
    title                text        NOT NULL,
    description          text        NOT NULL,
    topic                text        NOT NULL,
    publication_status   community.publication_status  NOT NULL DEFAULT 'published',
    verification_status  community.verification_status NOT NULL DEFAULT 'unverified',
    trust_score          integer     NOT NULL DEFAULT 0,
    location             geometry(Point, 4326),
    location_label       text,
    published_at         timestamptz NOT NULL DEFAULT now(),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    deleted_at           timestamptz,
    CONSTRAINT community_posts_public_id_key UNIQUE (public_id),
    CONSTRAINT community_posts_author_id_fkey
        FOREIGN KEY (author_id) REFERENCES app_auth.auth_users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT community_posts_trust_score_chk CHECK (trust_score BETWEEN -100000 AND 100000)
);

-- Legacy install path: table may already exist with old `status` column only.
ALTER TABLE community.community_posts
    ADD COLUMN IF NOT EXISTS publication_status community.publication_status,
    ADD COLUMN IF NOT EXISTS verification_status community.verification_status,
    ADD COLUMN IF NOT EXISTS location geometry(Point, 4326),
    ADD COLUMN IF NOT EXISTS location_label text,
    ADD COLUMN IF NOT EXISTS published_at timestamptz,
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Harden defaults on public_id / updated_at when missing.
DO $$
BEGIN
    ALTER TABLE community.community_posts
        ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE community.community_posts
        ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE community.community_posts
        ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

-- Map legacy post_status → publication_status + verification_status.
-- Preserve rows; terminal statuses keep publication state and reset verification
-- to unverified when the old model stored only one combined status.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'community'
          AND table_name = 'community_posts'
          AND column_name = 'status'
    ) THEN
        UPDATE community.community_posts
        SET
            publication_status = CASE status::text
                WHEN 'free_board' THEN 'published'::community.publication_status
                WHEN 'community_confirmed' THEN 'published'::community.publication_status
                WHEN 'admin_verified' THEN 'published'::community.publication_status
                WHEN 'rejected' THEN 'rejected'::community.publication_status
                WHEN 'resolved' THEN 'resolved'::community.publication_status
                WHEN 'expired' THEN 'expired'::community.publication_status
                ELSE 'published'::community.publication_status
            END,
            verification_status = CASE status::text
                WHEN 'community_confirmed' THEN 'community_confirmed'::community.verification_status
                WHEN 'admin_verified' THEN 'admin_verified'::community.verification_status
                WHEN 'free_board' THEN 'unverified'::community.verification_status
                ELSE 'unverified'::community.verification_status
            END,
            published_at = COALESCE(published_at, created_at, now()),
            updated_at = COALESCE(updated_at, now())
        WHERE publication_status IS NULL
           OR verification_status IS NULL
           OR published_at IS NULL;
    ELSE
        UPDATE community.community_posts
        SET
            publication_status = COALESCE(publication_status, 'published'::community.publication_status),
            verification_status = COALESCE(verification_status, 'unverified'::community.verification_status),
            published_at = COALESCE(published_at, created_at, now()),
            updated_at = COALESCE(updated_at, now())
        WHERE publication_status IS NULL
           OR verification_status IS NULL
           OR published_at IS NULL;
    END IF;
END $$;

ALTER TABLE community.community_posts
    ALTER COLUMN publication_status SET DEFAULT 'published',
    ALTER COLUMN verification_status SET DEFAULT 'unverified',
    ALTER COLUMN published_at SET DEFAULT now();

ALTER TABLE community.community_posts
    ALTER COLUMN publication_status SET NOT NULL,
    ALTER COLUMN verification_status SET NOT NULL,
    ALTER COLUMN published_at SET NOT NULL;

-- Drop legacy status column + index once mapped.
DROP INDEX IF EXISTS community.community_posts_status_idx;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'community'
          AND table_name = 'community_posts'
          AND column_name = 'status'
    ) THEN
        ALTER TABLE community.community_posts DROP COLUMN status;
    END IF;
END $$;

DO $$ BEGIN
    ALTER TABLE community.community_posts
        ADD CONSTRAINT community_posts_trust_score_chk
        CHECK (trust_score BETWEEN -100000 AND 100000);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- Ensure author FK points at app_auth (legacy installs may already have this).
DO $$ BEGIN
    ALTER TABLE community.community_posts
        ADD CONSTRAINT community_posts_author_id_fkey
        FOREIGN KEY (author_id) REFERENCES app_auth.auth_users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 3. notifications shell (before reaction enum swap so legacy FK/enum deps clear)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community.notifications (
    id               bigserial PRIMARY KEY,
    public_id        uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id          bigint NOT NULL,
    actor_user_id    bigint,
    type             community.notification_type NOT NULL,
    reaction_type    text,
    title            text NOT NULL,
    message          text NOT NULL,
    related_post_id  bigint,
    is_read          boolean NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at       timestamptz,
    CONSTRAINT notifications_public_id_key UNIQUE (public_id)
);

ALTER TABLE community.notifications
    ADD COLUMN IF NOT EXISTS actor_user_id bigint,
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'community'
          AND table_name = 'notifications'
          AND column_name = 'reaction_type'
    ) THEN
        ALTER TABLE community.notifications ADD COLUMN reaction_type text;
    END IF;
END $$;

DO $$
BEGIN
    ALTER TABLE community.notifications
        ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE community.notifications
        ALTER COLUMN created_at SET DEFAULT now();
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

-- Detach notifications.reaction_type from legacy enum → mapped text.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'community'
          AND table_name = 'notifications'
          AND column_name = 'reaction_type'
    ) THEN
        ALTER TABLE community.notifications
            ALTER COLUMN reaction_type TYPE text
            USING (
                CASE reaction_type::text
                    WHEN 'useful' THEN 'helpful'
                    WHEN 'fake' THEN 'incorrect'
                    WHEN 'resolved' THEN NULL
                    WHEN 'confirm' THEN 'confirm'
                    WHEN 'helpful' THEN 'helpful'
                    WHEN 'incorrect' THEN 'incorrect'
                    ELSE NULLIF(reaction_type::text, '')
                END
            );
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. post_reactions — normalize enum, keep one-row-per-user uniqueness
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community.post_reactions (
    id             bigserial PRIMARY KEY,
    post_id        bigint NOT NULL,
    user_id        bigint NOT NULL,
    reaction_type  text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT post_reactions_post_id_user_id_key UNIQUE (post_id, user_id),
    CONSTRAINT post_reactions_post_id_fkey
        FOREIGN KEY (post_id) REFERENCES community.community_posts(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT post_reactions_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES app_auth.auth_users(id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

-- Convert legacy reaction enum → mapped text (drop resolved reactions).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'community'
          AND table_name = 'post_reactions'
          AND column_name = 'reaction_type'
    ) THEN
        DELETE FROM community.post_reactions
        WHERE reaction_type::text = 'resolved';

        ALTER TABLE community.post_reactions
            ALTER COLUMN reaction_type TYPE text
            USING (
                CASE reaction_type::text
                    WHEN 'confirm' THEN 'confirm'
                    WHEN 'useful' THEN 'helpful'
                    WHEN 'helpful' THEN 'helpful'
                    WHEN 'fake' THEN 'incorrect'
                    WHEN 'incorrect' THEN 'incorrect'
                    ELSE 'confirm'
                END
            );
    END IF;
END $$;

ALTER TABLE community.post_reactions
    ALTER COLUMN created_at SET DEFAULT now(),
    ALTER COLUMN updated_at SET DEFAULT now();

DO $$ BEGIN
    ALTER TABLE community.post_reactions
        ADD CONSTRAINT post_reactions_post_id_fkey
        FOREIGN KEY (post_id) REFERENCES community.community_posts(id)
        ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE community.post_reactions
        ADD CONSTRAINT post_reactions_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES app_auth.auth_users(id)
        ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE community.post_reactions
        ADD CONSTRAINT post_reactions_post_id_user_id_key UNIQUE (post_id, user_id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- Drop legacy reaction_type enum (no remaining dependents), then install final enum.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'community' AND t.typname = 'reaction_type'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_type t ON t.oid = a.atttypid
        WHERE n.nspname = 'community'
          AND t.typname = 'reaction_type'
          AND a.attnum > 0
          AND NOT a.attisdropped
    ) THEN
        DROP TYPE community.reaction_type;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'community' AND t.typname = 'reaction_type_v2'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'community' AND t.typname = 'reaction_type'
    ) THEN
        ALTER TYPE community.reaction_type_v2 RENAME TO reaction_type;
    ELSIF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'community' AND t.typname = 'reaction_type'
    ) THEN
        CREATE TYPE community.reaction_type AS ENUM ('confirm', 'helpful', 'incorrect');
    END IF;
END $$;

-- Attach final reaction enum to reactions + notifications.
ALTER TABLE community.post_reactions
    ALTER COLUMN reaction_type TYPE community.reaction_type
    USING reaction_type::community.reaction_type;

ALTER TABLE community.notifications
    ALTER COLUMN reaction_type TYPE community.reaction_type
    USING CASE
        WHEN reaction_type IS NULL THEN NULL
        ELSE reaction_type::community.reaction_type
    END;

-- Drop obsolete post_status enum after status column removal.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'community' AND t.typname = 'post_status'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_type t ON t.oid = a.atttypid
        WHERE n.nspname = 'community'
          AND t.typname = 'post_status'
          AND a.attnum > 0
          AND NOT a.attisdropped
    ) THEN
        DROP TYPE community.post_status;
    END IF;
END $$;

-- Drop leftover reaction_type_v2 if rename already produced reaction_type.
DROP TYPE IF EXISTS community.reaction_type_v2;

DO $$ BEGIN
    ALTER TABLE community.notifications
        ADD CONSTRAINT notifications_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES app_auth.auth_users(id)
        ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE community.notifications
        ADD CONSTRAINT notifications_actor_user_id_fkey
        FOREIGN KEY (actor_user_id) REFERENCES app_auth.auth_users(id)
        ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE community.notifications
        ADD CONSTRAINT notifications_related_post_id_fkey
        FOREIGN KEY (related_post_id) REFERENCES community.community_posts(id)
        ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE community.notifications
        ADD CONSTRAINT notifications_public_id_key UNIQUE (public_id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Append-only moderation history
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community.post_moderation_events (
    id                         bigserial PRIMARY KEY,
    public_id                  uuid NOT NULL DEFAULT gen_random_uuid(),
    post_id                    bigint NOT NULL,
    actor_user_id              bigint,
    action_code                text NOT NULL,
    from_publication_status    community.publication_status,
    to_publication_status      community.publication_status,
    from_verification_status   community.verification_status,
    to_verification_status     community.verification_status,
    note                       text,
    metadata                   jsonb,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT post_moderation_events_public_id_key UNIQUE (public_id),
    CONSTRAINT post_moderation_events_action_code_chk
        CHECK (action_code = ANY (ARRAY[
            'migrate_baseline',
            'publish',
            'verify',
            'unverify',
            'reject',
            'resolve',
            'expire',
            'remove',
            'restore',
            'community_auto_confirm',
            'community_auto_unconfirm',
            'other'
        ])),
    CONSTRAINT post_moderation_events_post_id_fkey
        FOREIGN KEY (post_id) REFERENCES community.community_posts(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT post_moderation_events_actor_user_id_fkey
        FOREIGN KEY (actor_user_id) REFERENCES app_auth.auth_users(id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

-- One baseline audit row per existing post (idempotent by action + null actor).
INSERT INTO community.post_moderation_events (
    post_id,
    actor_user_id,
    action_code,
    from_publication_status,
    to_publication_status,
    from_verification_status,
    to_verification_status,
    note,
    metadata
)
SELECT
    p.id,
    NULL,
    'migrate_baseline',
    NULL,
    p.publication_status,
    NULL,
    p.verification_status,
    'Mapped from legacy community.post_status during production contract migration.',
    jsonb_build_object(
        'source', '20260917010000_community_production_contract',
        'trust_score', p.trust_score
    )
FROM community.community_posts p
WHERE NOT EXISTS (
    SELECT 1
    FROM community.post_moderation_events e
    WHERE e.post_id = p.id
      AND e.action_code = 'migrate_baseline'
);

-- ----------------------------------------------------------------------------
-- 6. Indexes required by the production contract
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS community_posts_public_id_key
    ON community.community_posts (public_id);

CREATE INDEX IF NOT EXISTS community_posts_author_id_idx
    ON community.community_posts (author_id);

CREATE INDEX IF NOT EXISTS community_posts_author_published_at_idx
    ON community.community_posts (author_id, published_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS community_posts_publication_status_idx
    ON community.community_posts (publication_status);

CREATE INDEX IF NOT EXISTS community_posts_verification_status_idx
    ON community.community_posts (verification_status);

CREATE INDEX IF NOT EXISTS community_posts_pub_ver_idx
    ON community.community_posts (publication_status, verification_status)
    WHERE deleted_at IS NULL;

-- Cursor pagination for Latest / Trusted feeds.
CREATE INDEX IF NOT EXISTS community_posts_published_at_id_idx
    ON community.community_posts (published_at DESC, id DESC)
    WHERE deleted_at IS NULL
      AND publication_status = 'published';

CREATE INDEX IF NOT EXISTS community_posts_location_gix
    ON community.community_posts USING GIST (location)
    WHERE location IS NOT NULL;

CREATE INDEX IF NOT EXISTS post_reactions_post_id_idx
    ON community.post_reactions (post_id);

CREATE INDEX IF NOT EXISTS post_reactions_user_id_idx
    ON community.post_reactions (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS post_reactions_post_id_user_id_key
    ON community.post_reactions (post_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_public_id_key
    ON community.notifications (public_id);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx
    ON community.notifications (user_id);

CREATE INDEX IF NOT EXISTS notifications_user_unread_created_idx
    ON community.notifications (user_id, created_at DESC)
    WHERE is_read = false AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_is_read_idx
    ON community.notifications (is_read);

CREATE INDEX IF NOT EXISTS notifications_related_post_id_idx
    ON community.notifications (related_post_id);

CREATE INDEX IF NOT EXISTS notifications_actor_user_id_idx
    ON community.notifications (actor_user_id);

CREATE INDEX IF NOT EXISTS post_moderation_events_post_created_idx
    ON community.post_moderation_events (post_id, created_at DESC);

CREATE INDEX IF NOT EXISTS post_moderation_events_actor_idx
    ON community.post_moderation_events (actor_user_id)
    WHERE actor_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS post_moderation_events_action_idx
    ON community.post_moderation_events (action_code, created_at DESC);

-- ----------------------------------------------------------------------------
-- 7. RLS defense-in-depth (API-only; no anon policies)
-- ----------------------------------------------------------------------------
ALTER TABLE community.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.post_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.post_moderation_events ENABLE ROW LEVEL SECURITY;

COMMIT;
