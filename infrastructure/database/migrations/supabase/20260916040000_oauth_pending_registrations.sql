-- =============================================================================
-- 20260916040000_oauth_pending_registrations.sql
-- Short-lived pending OAuth registration when provider returns no usable email
-- (typical for some Facebook accounts). Opaque flow token only; no access tokens.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS app_auth.oauth_pending_registrations (
    id                      bigserial PRIMARY KEY,
    public_id               uuid        NOT NULL DEFAULT gen_random_uuid(),
    token_hash              text        NOT NULL,
    provider                text        NOT NULL,
    provider_subject        text        NOT NULL,
    provider_name           text,
    provider_email          text,
    provider_email_verified boolean     NOT NULL DEFAULT false,
    client                  text        NOT NULL DEFAULT 'web',
    return_to               text,
    email_pending           text,
    otp_hash                text,
    otp_expires_at          timestamptz,
    otp_attempts_count      integer     NOT NULL DEFAULT 0,
    otp_max_attempts        integer     NOT NULL DEFAULT 5,
    expires_at              timestamptz NOT NULL,
    consumed_at             timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT oauth_pending_registrations_public_id_key UNIQUE (public_id),
    CONSTRAINT oauth_pending_registrations_token_hash_key UNIQUE (token_hash),
    CONSTRAINT oauth_pending_registrations_provider_chk
        CHECK (provider = ANY (ARRAY['google'::text, 'facebook'::text])),
    CONSTRAINT oauth_pending_registrations_client_chk
        CHECK (client = ANY (ARRAY['web'::text, 'dashboard'::text, 'android'::text, 'ios'::text]))
);

COMMENT ON TABLE app_auth.oauth_pending_registrations IS
    'One-time pending OAuth signup when provider identity is verified but no usable email yet.';

CREATE INDEX IF NOT EXISTS oauth_pending_registrations_active_provider_subject_idx
    ON app_auth.oauth_pending_registrations (provider, provider_subject)
    WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS oauth_pending_registrations_expires_idx
    ON app_auth.oauth_pending_registrations (expires_at)
    WHERE consumed_at IS NULL;

COMMIT;
