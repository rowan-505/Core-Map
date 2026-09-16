-- =============================================================================
-- 20260916010000_auth_production_hardening.sql
-- Additive auth hardening for CoreMap-owned app_auth (not Supabase Auth / GoTrue).
-- Safe to re-run. Does not drop user data.
-- =============================================================================

BEGIN;

-- Password-only accounts keep a hash; OAuth-only accounts may have NULL.
ALTER TABLE app_auth.auth_users
    ALTER COLUMN password_hash DROP NOT NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_users_password_hash_chk') THEN
        ALTER TABLE app_auth.auth_users DROP CONSTRAINT auth_users_password_hash_chk;
    END IF;
END $$;

ALTER TABLE app_auth.auth_users
    ADD CONSTRAINT auth_users_password_hash_chk
    CHECK (password_hash IS NULL OR btrim(password_hash) <> '');

-- Identities (password / google / facebook). Never store provider tokens here.
CREATE TABLE IF NOT EXISTS app_auth.auth_identities (
    id                      bigserial   PRIMARY KEY,
    public_id               uuid        NOT NULL DEFAULT gen_random_uuid(),
    user_id                 bigint      NOT NULL,
    provider                text        NOT NULL,
    provider_subject        text        NOT NULL,
    provider_email          text,
    provider_email_verified boolean     NOT NULL DEFAULT false,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    last_login_at           timestamptz,
    CONSTRAINT auth_identities_public_id_key UNIQUE (public_id),
    CONSTRAINT auth_identities_provider_subject_key UNIQUE (provider, provider_subject),
    CONSTRAINT auth_identities_provider_chk CHECK (provider = ANY (ARRAY['password'::text, 'google'::text, 'facebook'::text])),
    CONSTRAINT auth_identities_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES app_auth.auth_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS auth_identities_user_idx
    ON app_auth.auth_identities (user_id);

INSERT INTO app_auth.auth_identities (user_id, provider, provider_subject, provider_email, provider_email_verified, last_login_at)
SELECT u.id, 'password', u.public_id::text, u.email, u.email_verified, u.last_login_at
FROM app_auth.auth_users u
WHERE u.password_hash IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM app_auth.auth_identities i
      WHERE i.user_id = u.id AND i.provider = 'password'
  );

-- Session family / idle / absolute expiry / reuse detection support.
ALTER TABLE app_auth.auth_sessions
    ADD COLUMN IF NOT EXISTS token_family_id uuid,
    ADD COLUMN IF NOT EXISTS previous_refresh_token_hash text,
    ADD COLUMN IF NOT EXISTS idle_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS revoke_reason text;

UPDATE app_auth.auth_sessions
SET token_family_id = COALESCE(token_family_id, gen_random_uuid()),
    idle_expires_at = COALESCE(idle_expires_at, expires_at),
    absolute_expires_at = COALESCE(absolute_expires_at, expires_at);

ALTER TABLE app_auth.auth_sessions
    ALTER COLUMN token_family_id SET DEFAULT gen_random_uuid(),
    ALTER COLUMN token_family_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_refresh_hash_uidx
    ON app_auth.auth_sessions (refresh_token_hash);
CREATE INDEX IF NOT EXISTS auth_sessions_family_idx
    ON app_auth.auth_sessions (token_family_id);
CREATE INDEX IF NOT EXISTS auth_sessions_previous_hash_idx
    ON app_auth.auth_sessions (previous_refresh_token_hash)
    WHERE previous_refresh_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_auth.password_reset_tokens (
    id          bigserial   PRIMARY KEY,
    user_id     bigint      NOT NULL,
    token_hash  text        NOT NULL,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash),
    CONSTRAINT password_reset_tokens_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES app_auth.auth_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
    ON app_auth.password_reset_tokens (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_auth.auth_security_events (
    id          bigserial   PRIMARY KEY,
    user_id     bigint,
    session_id  bigint,
    event_type  text        NOT NULL,
    provider    text,
    success     boolean     NOT NULL DEFAULT true,
    ip_address  text,
    user_agent  text,
    metadata    jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT auth_security_events_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES app_auth.auth_users(id) ON DELETE SET NULL,
    CONSTRAINT auth_security_events_session_id_fkey
        FOREIGN KEY (session_id) REFERENCES app_auth.auth_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS auth_security_events_user_idx
    ON app_auth.auth_security_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_security_events_type_idx
    ON app_auth.auth_security_events (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS app_auth.oauth_states (
    id                  bigserial   PRIMARY KEY,
    state_hash          text        NOT NULL,
    code_verifier_hash  text,
    nonce_hash          text,
    client              text        NOT NULL DEFAULT 'web',
    return_to           text,
    expires_at          timestamptz NOT NULL,
    consumed_at         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT oauth_states_state_hash_key UNIQUE (state_hash)
);

CREATE INDEX IF NOT EXISTS oauth_states_active_idx
    ON app_auth.oauth_states (expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS app_auth.auth_mfa_methods (
    id              bigserial   PRIMARY KEY,
    public_id       uuid        NOT NULL DEFAULT gen_random_uuid(),
    user_id         bigint      NOT NULL,
    method          text        NOT NULL DEFAULT 'totp',
    secret_encrypted text       NOT NULL,
    verified_at     timestamptz,
    revoked_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT auth_mfa_methods_public_id_key UNIQUE (public_id),
    CONSTRAINT auth_mfa_methods_method_chk CHECK (method = 'totp'),
    CONSTRAINT auth_mfa_methods_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES app_auth.auth_users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_mfa_methods_active_user_idx
    ON app_auth.auth_mfa_methods (user_id)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS app_auth.auth_mfa_recovery_codes (
    id          bigserial   PRIMARY KEY,
    method_id   bigint      NOT NULL,
    code_hash   text        NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT auth_mfa_recovery_codes_method_id_fkey
        FOREIGN KEY (method_id) REFERENCES app_auth.auth_mfa_methods(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS auth_mfa_recovery_codes_method_idx
    ON app_auth.auth_mfa_recovery_codes (method_id);

COMMIT;
