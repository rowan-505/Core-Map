import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
    getOAuthProviderCapabilities,
    loadApiEnv,
    resetApiEnvCacheForTests,
} from "../../config/env.js";
import { AuthError, AuthService } from "./auth.service.js";
import type { AuthRepository } from "./auth.repo.js";

const FB_ENV_KEYS = [
    "NODE_ENV",
    "FACEBOOK_OAUTH_ENABLED",
    "FACEBOOK_OAUTH_APP_ID",
    "FACEBOOK_OAUTH_APP_SECRET",
    "FACEBOOK_OAUTH_REDIRECT_URI",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "WEB_APP_URL",
    "API_PUBLIC_URL",
    "DASHBOARD_APP_URL",
    "AUTH_JWT_SECRET",
    "EMAIL_OTP_SECRET",
    "AUTH_MFA_ENCRYPTION_KEY",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
    const snap: Record<string, string | undefined> = {};
    for (const key of FB_ENV_KEYS) {
        snap[key] = process.env[key];
    }
    return snap;
}

function restoreEnv(snap: Record<string, string | undefined>) {
    for (const key of FB_ENV_KEYS) {
        const value = snap[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

function clearFacebookSecrets() {
    delete process.env.FACEBOOK_OAUTH_APP_ID;
    delete process.env.FACEBOOK_OAUTH_APP_SECRET;
    delete process.env.FACEBOOK_OAUTH_REDIRECT_URI;
}

describe("Facebook OAuth feature flag", () => {
    const previous = snapshotEnv();

    afterEach(() => {
        restoreEnv(previous);
        resetApiEnvCacheForTests();
    });

    it("defaults Facebook off and starts without Facebook secrets", () => {
        resetApiEnvCacheForTests();
        process.env.NODE_ENV = "production";
        delete process.env.FACEBOOK_OAUTH_ENABLED;
        clearFacebookSecrets();
        process.env.WEB_APP_URL = "https://map.coremapmm.com";
        process.env.API_PUBLIC_URL = "https://api.coremapmm.com";
        process.env.DASHBOARD_APP_URL = "https://admin.coremapmm.com";
        process.env.AUTH_JWT_SECRET = "x".repeat(40);
        process.env.EMAIL_OTP_SECRET = "otp-secret-at-least-16";
        process.env.AUTH_MFA_ENCRYPTION_KEY = "m".repeat(32);
        process.env.GOOGLE_OAUTH_CLIENT_ID = "google-id";
        process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-secret";
        process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://api.coremapmm.com/auth/oauth/google/callback";

        const env = loadApiEnv();
        assert.equal(env.auth.facebookEnabled, false);
        assert.equal(env.auth.facebook, null);
        assert.ok(env.auth.google);
        assert.deepEqual(getOAuthProviderCapabilities(), { google: true, facebook: false });
    });

    it("requires Facebook secrets when FACEBOOK_OAUTH_ENABLED=true", () => {
        resetApiEnvCacheForTests();
        process.env.NODE_ENV = "development";
        process.env.FACEBOOK_OAUTH_ENABLED = "true";
        clearFacebookSecrets();
        assert.throws(() => loadApiEnv(), /FACEBOOK_OAUTH_APP_ID/);
    });

    it("enabling Facebook restores provider config when secrets are set", () => {
        resetApiEnvCacheForTests();
        process.env.NODE_ENV = "development";
        process.env.FACEBOOK_OAUTH_ENABLED = "true";
        process.env.FACEBOOK_OAUTH_APP_ID = "fb-app";
        process.env.FACEBOOK_OAUTH_APP_SECRET = "fb-secret";
        process.env.FACEBOOK_OAUTH_REDIRECT_URI =
            "http://localhost:3001/auth/oauth/facebook/callback";
        const env = loadApiEnv();
        assert.equal(env.auth.facebookEnabled, true);
        assert.equal(env.auth.facebook?.clientId, "fb-app");
        assert.deepEqual(getOAuthProviderCapabilities(), {
            google: Boolean(env.auth.google),
            facebook: true,
        });
    });

    it("blocks Facebook OAuth start/callback/link when disabled", async () => {
        resetApiEnvCacheForTests();
        process.env.NODE_ENV = "production";
        process.env.FACEBOOK_OAUTH_ENABLED = "false";
        clearFacebookSecrets();
        process.env.WEB_APP_URL = "https://map.coremapmm.com";
        process.env.API_PUBLIC_URL = "https://api.coremapmm.com";
        process.env.DASHBOARD_APP_URL = "https://admin.coremapmm.com";
        process.env.AUTH_JWT_SECRET = "x".repeat(40);
        process.env.EMAIL_OTP_SECRET = "otp-secret-at-least-16";
        process.env.AUTH_MFA_ENCRYPTION_KEY = "m".repeat(32);
        process.env.GOOGLE_OAUTH_CLIENT_ID = "google-id";
        process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-secret";
        process.env.GOOGLE_OAUTH_REDIRECT_URI =
            "https://api.coremapmm.com/auth/oauth/google/callback";
        loadApiEnv();

        const auth = new AuthService({} as AuthRepository);
        await assert.rejects(
            () => auth.startOAuth("facebook", { client: "web" }),
            (err: unknown) => err instanceof AuthError && err.code === "feature_disabled"
        );
        await assert.rejects(
            () =>
                auth.completeOAuth("facebook", {
                    code: "x",
                    state: "y",
                    cookiePayload: null,
                    refreshToken: null,
                    context: {},
                }),
            (err: unknown) => err instanceof AuthError && err.code === "feature_disabled"
        );
        await assert.rejects(
            () =>
                auth.startOAuthLink("facebook", {
                    userPublicId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                    sessionPublicId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                }),
            (err: unknown) => err instanceof AuthError && err.code === "feature_disabled"
        );
    });
});
