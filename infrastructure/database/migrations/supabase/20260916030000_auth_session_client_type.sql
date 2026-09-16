-- =============================================================================
-- 20260916030000_auth_session_client_type.sql
-- Tag auth_sessions with client_type for Web/Dashboard now and Android/iOS later.
-- Additive. Does not change authorization (roles still gate dashboard access).
-- =============================================================================

BEGIN;

ALTER TABLE app_auth.auth_sessions
    ADD COLUMN IF NOT EXISTS client_type text;

UPDATE app_auth.auth_sessions
SET client_type = COALESCE(client_type, 'web')
WHERE client_type IS NULL;

ALTER TABLE app_auth.auth_sessions
    ALTER COLUMN client_type SET DEFAULT 'web',
    ALTER COLUMN client_type SET NOT NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_sessions_client_type_chk') THEN
        ALTER TABLE app_auth.auth_sessions DROP CONSTRAINT auth_sessions_client_type_chk;
    END IF;
END $$;

ALTER TABLE app_auth.auth_sessions
    ADD CONSTRAINT auth_sessions_client_type_chk
    CHECK (client_type = ANY (ARRAY['web'::text, 'dashboard'::text, 'android'::text, 'ios'::text]));

CREATE INDEX IF NOT EXISTS auth_sessions_user_client_active_idx
    ON app_auth.auth_sessions (user_id, client_type)
    WHERE revoked_at IS NULL;

COMMIT;
