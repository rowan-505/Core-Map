-- =============================================================================
-- 20260916020000_auth_oauth_link_intent.sql
-- Authenticated OAuth link intent on oauth_states + one provider per user.
-- Additive. Safe to re-run. Does not weaken email-collision link_required policy.
-- =============================================================================

BEGIN;

ALTER TABLE app_auth.oauth_states
    ADD COLUMN IF NOT EXISTS purpose text,
    ADD COLUMN IF NOT EXISTS link_user_id bigint,
    ADD COLUMN IF NOT EXISTS link_session_public_id uuid;

UPDATE app_auth.oauth_states
SET purpose = COALESCE(purpose, 'login')
WHERE purpose IS NULL;

ALTER TABLE app_auth.oauth_states
    ALTER COLUMN purpose SET DEFAULT 'login',
    ALTER COLUMN purpose SET NOT NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_states_purpose_chk') THEN
        ALTER TABLE app_auth.oauth_states DROP CONSTRAINT oauth_states_purpose_chk;
    END IF;
END $$;

ALTER TABLE app_auth.oauth_states
    ADD CONSTRAINT oauth_states_purpose_chk
    CHECK (purpose = ANY (ARRAY['login'::text, 'link'::text]));

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_states_link_fields_chk') THEN
        ALTER TABLE app_auth.oauth_states DROP CONSTRAINT oauth_states_link_fields_chk;
    END IF;
END $$;

ALTER TABLE app_auth.oauth_states
    ADD CONSTRAINT oauth_states_link_fields_chk
    CHECK (
        (purpose = 'login' AND link_user_id IS NULL AND link_session_public_id IS NULL)
        OR (purpose = 'link' AND link_user_id IS NOT NULL AND link_session_public_id IS NOT NULL)
    );

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_states_link_user_id_fkey') THEN
        ALTER TABLE app_auth.oauth_states DROP CONSTRAINT oauth_states_link_user_id_fkey;
    END IF;
END $$;

ALTER TABLE app_auth.oauth_states
    ADD CONSTRAINT oauth_states_link_user_id_fkey
    FOREIGN KEY (link_user_id) REFERENCES app_auth.auth_users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS oauth_states_link_user_idx
    ON app_auth.oauth_states (link_user_id)
    WHERE purpose = 'link' AND consumed_at IS NULL;

-- At most one google / facebook / password identity row per CoreMap user.
CREATE UNIQUE INDEX IF NOT EXISTS auth_identities_user_provider_uidx
    ON app_auth.auth_identities (user_id, provider)
    WHERE provider = ANY (ARRAY['password'::text, 'google'::text, 'facebook'::text]);

COMMIT;
