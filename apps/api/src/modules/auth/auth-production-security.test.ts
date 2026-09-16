import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FastifyRequest } from "fastify";

import { loadApiEnv, resetApiEnvCacheForTests } from "../../config/env.js";
import { hashOtp } from "../../lib/security/otp.js";
import { AuthError, AuthService } from "./auth.service.js";
import type { AuthRepository, AuthUserRecord } from "./auth.repo.js";
import { hashPassword } from "./password.js";
import {
    assertCookieMutationCsrf,
    assertCsrfOrigin,
    assertLoginCsrfOrigin,
} from "./session-cookie.js";

const PROD_KEYS = [
    "NODE_ENV",
    "WEB_APP_URL",
    "API_PUBLIC_URL",
    "DASHBOARD_APP_URL",
    "AUTH_JWT_SECRET",
    "EMAIL_OTP_SECRET",
    "AUTH_MFA_ENCRYPTION_KEY",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "FACEBOOK_OAUTH_ENABLED",
    "CORS_ORIGIN",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
    const snap: Record<string, string | undefined> = {};
    for (const key of PROD_KEYS) snap[key] = process.env[key];
    return snap;
}

function restoreEnv(snap: Record<string, string | undefined>) {
    for (const key of PROD_KEYS) {
        const value = snap[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

function setMinimalProductionEnv() {
    process.env.NODE_ENV = "production";
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
    process.env.FACEBOOK_OAUTH_ENABLED = "false";
    process.env.CORS_ORIGIN = "https://map.coremapmm.com,https://admin.coremapmm.com";
}

function user(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
    return {
        id: "1",
        public_id: "11111111-1111-4111-8111-111111111111",
        email: "ada@example.com",
        display_name: "Ada",
        password_hash: "hash",
        is_active: true,
        account_status: "active",
        email_verified: true,
        roles: ["user"],
        ...overrides,
    };
}

function repo(partial: Partial<AuthRepository>): AuthRepository {
    return partial as AuthRepository;
}

function fakeRequest(origin?: string | null, cookie?: string | null): FastifyRequest {
    return {
        headers: origin === null || origin === undefined ? {} : { origin },
        cookies: cookie ? { cm_rt: cookie } : {},
    } as FastifyRequest;
}

describe("production auth env fail-fast", () => {
    const previous = snapshotEnv();
    afterEach(() => {
        restoreEnv(previous);
        resetApiEnvCacheForTests();
    });

    it("fails when EMAIL_OTP_SECRET is missing", () => {
        resetApiEnvCacheForTests();
        setMinimalProductionEnv();
        delete process.env.EMAIL_OTP_SECRET;
        assert.throws(() => loadApiEnv(), /EMAIL_OTP_SECRET/);
    });

    it("fails when AUTH_MFA_ENCRYPTION_KEY is missing", () => {
        resetApiEnvCacheForTests();
        setMinimalProductionEnv();
        delete process.env.AUTH_MFA_ENCRYPTION_KEY;
        assert.throws(() => loadApiEnv(), /AUTH_MFA_ENCRYPTION_KEY/);
    });

    it("fails when Google OAuth config is missing", () => {
        resetApiEnvCacheForTests();
        setMinimalProductionEnv();
        delete process.env.GOOGLE_OAUTH_CLIENT_ID;
        delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
        delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
        assert.throws(() => loadApiEnv(), /GOOGLE_OAUTH/);
    });

    it("fails when Google redirect URI is http", () => {
        resetApiEnvCacheForTests();
        setMinimalProductionEnv();
        process.env.GOOGLE_OAUTH_REDIRECT_URI =
            "http://api.coremapmm.com/auth/oauth/google/callback";
        assert.throws(() => loadApiEnv(), /https/);
    });

    it("loads when production auth secrets are complete and Facebook stays off", () => {
        resetApiEnvCacheForTests();
        setMinimalProductionEnv();
        const env = loadApiEnv();
        assert.equal(env.auth.facebookEnabled, false);
        assert.ok(env.auth.google);
        assert.ok(env.email.otpSecret);
        assert.ok(env.auth.mfaEncryptionKey);
    });
});

describe("CSRF Origin fail-closed", () => {
    const previous = snapshotEnv();
    afterEach(() => {
        restoreEnv(previous);
        resetApiEnvCacheForTests();
    });

    it("allows map and admin origins; rejects evil and missing Origin on cookie mutation", () => {
        resetApiEnvCacheForTests();
        setMinimalProductionEnv();
        loadApiEnv();

        assert.doesNotThrow(() => assertCsrfOrigin(fakeRequest("https://map.coremapmm.com")));
        assert.doesNotThrow(() => assertCsrfOrigin(fakeRequest("https://admin.coremapmm.com")));
        assert.throws(
            () => assertCsrfOrigin(fakeRequest("https://evil.example")),
            (err: unknown) =>
                err instanceof Error && (err as { statusCode?: number }).statusCode === 403
        );
        assert.throws(
            () => assertCsrfOrigin(fakeRequest(null)),
            (err: unknown) =>
                err instanceof Error && (err as { statusCode?: number }).statusCode === 403
        );
        assert.throws(
            () => assertCsrfOrigin(fakeRequest("http://[::1")),
            (err: unknown) =>
                err instanceof Error && (err as { statusCode?: number }).statusCode === 403
        );

        // In production the refresh cookie name is __Host-cm_rt.
        const prodCookieReq = {
            headers: {},
            cookies: { "__Host-cm_rt": "refresh-cookie" },
        } as unknown as FastifyRequest;
        assert.throws(
            () => assertCookieMutationCsrf(prodCookieReq),
            (err: unknown) =>
                err instanceof Error && (err as { statusCode?: number }).statusCode === 403
        );
        assert.doesNotThrow(() => assertLoginCsrfOrigin(fakeRequest(null)));
    });
});

describe("privileged password reset policy", () => {
    it("accepts normal 8+ char reset and rejects privileged short passwords", async () => {
        const passwordHash = await hashPassword("old-password-12");
        let updated: string | null = null;
        const auth = new AuthService(
            repo({
                consumePasswordResetToken: async () => ({ user_id: 1n }),
                findUserById: async () => user({ password_hash: passwordHash, roles: ["admin"] }),
                updatePasswordHash: async (_id, hash) => {
                    updated = hash;
                },
                revokeAllUserSessions: async () => 1,
                recordSecurityEvent: async () => undefined,
            })
        );
        await assert.rejects(
            () => auth.resetPassword("token", "shortpwd"),
            (err: unknown) => err instanceof AuthError && err.code === "password_policy"
        );
        assert.equal(updated, null);

        const normal = new AuthService(
            repo({
                consumePasswordResetToken: async () => ({ user_id: 1n }),
                findUserById: async () => user({ password_hash: passwordHash, roles: ["user"] }),
                updatePasswordHash: async (_id, hash) => {
                    updated = hash;
                },
                revokeAllUserSessions: async () => 1,
                recordSecurityEvent: async () => undefined,
            })
        );
        await normal.resetPassword("token", "longenough");
        assert.ok(updated);

        updated = null;
        const privilegedOk = new AuthService(
            repo({
                consumePasswordResetToken: async () => ({ user_id: 1n }),
                findUserById: async () =>
                    user({ password_hash: passwordHash, roles: ["super_admin"] }),
                updatePasswordHash: async (_id, hash) => {
                    updated = hash;
                },
                revokeAllUserSessions: async () => 1,
                recordSecurityEvent: async () => undefined,
            })
        );
        await privilegedOk.resetPassword("token", "twelve chars!");
        assert.ok(updated);
    });
});

describe("mandatory admin MFA enrollment gate", () => {
    it("lets normal users login without MFA", async () => {
        const passwordHash = await hashPassword("correct-password-12");
        const auth = new AuthService(
            repo({
                findUserByEmail: async () =>
                    user({ password_hash: passwordHash, roles: ["user"], email_verified: true }),
                touchLastLogin: async () => undefined,
                cleanupExpiredSessions: async () => undefined,
                createSession: async () =>
                    ({
                        id: 1n,
                        public_id: "22222222-2222-4222-8222-222222222222",
                        token_family_id: "33333333-3333-4333-8333-333333333333",
                        client_type: "web",
                    }) as never,
                recordSecurityEvent: async () => undefined,
            })
        );
        const outcome = await auth.login(
            { email: "ada@example.com" },
            "correct-password-12",
            {},
            { requireDashboard: false }
        );
        assert.equal(outcome.kind, "session");
    });

    it("blocks dashboard admin login without MFA enrollment", async () => {
        const passwordHash = await hashPassword("correct-password-12");
        const auth = new AuthService(
            repo({
                findUserByEmail: async () =>
                    user({
                        password_hash: passwordHash,
                        roles: ["admin"],
                        email_verified: true,
                    }),
                findActiveTotp: async () => null,
                recordSecurityEvent: async () => undefined,
            })
        );
        const outcome = await auth.login(
            { email: "ada@example.com" },
            "correct-password-12",
            { clientType: "dashboard" },
            { requireDashboard: true }
        );
        assert.equal(outcome.kind, "mfa_enrollment_required");
    });

    it("requires TOTP when admin already has MFA", async () => {
        const passwordHash = await hashPassword("correct-password-12");
        const auth = new AuthService(
            repo({
                findUserByEmail: async () =>
                    user({
                        password_hash: passwordHash,
                        roles: ["super_admin"],
                        email_verified: true,
                    }),
                findActiveTotp: async () =>
                    ({
                        id: 1n,
                        secretEncrypted: "x",
                        status: "active",
                    }) as never,
                recordSecurityEvent: async () => undefined,
            })
        );
        const outcome = await auth.login(
            { email: "ada@example.com" },
            "correct-password-12",
            { clientType: "dashboard" },
            { requireDashboard: true }
        );
        assert.equal(outcome.kind, "mfa");
    });
});

describe("reset token invalidation", () => {
    it("calls createPasswordResetToken which invalidates prior unused tokens in-repo", async () => {
        let createCalls = 0;
        const auth = new AuthService(
            repo({
                findUserByEmail: async () => user({ roles: ["user"] }),
                createPasswordResetToken: async () => {
                    createCalls += 1;
                },
                recordSecurityEvent: async () => undefined,
            }),
            {
                emailService: {
                    isConfigured: () => true,
                    sendPasswordReset: async () => undefined,
                } as never,
                otpSecret: "test-otp-secret",
                ttlMinutes: 10,
                maxAttempts: 5,
            }
        );
        await auth.forgotPassword("ada@example.com");
        await auth.forgotPassword("ada@example.com");
        assert.equal(createCalls, 2);
    });
});

describe("email change revokes other sessions", () => {
    it("keeps current session and revokes others after successful verify", async () => {
        const otpSecret = "email-change-otp-secret";
        const code = "123456";
        let revokedExcept: string | undefined;
        const auth = new AuthService(
            repo({
                findUserByPublicId: async () => user({ roles: ["user"] }),
                findLatestUnconsumedOtpByPurpose: async () =>
                    ({
                        id: 9n,
                        otp_hash: hashOtp(code, otpSecret),
                        expires_at: new Date(Date.now() + 60_000),
                        email: "new@example.com",
                        attempts: 0,
                        max_attempts: 5,
                        attempts_count: 0,
                        consumed_at: null,
                        created_at: new Date(),
                    }) as never,
                consumeOtpAtomic: async () => true,
                incrementOtpAttemptsAtomic: async () => true,
                updateEmail: async () => undefined,
                revokeAllUserSessions: async (_id, _reason, except) => {
                    revokedExcept = except;
                    return 2;
                },
                recordSecurityEvent: async () => undefined,
            }),
            {
                emailService: {
                    isConfigured: () => true,
                    sendEmailChangedNotice: async () => undefined,
                } as never,
                otpSecret,
                ttlMinutes: 10,
                maxAttempts: 5,
            }
        );
        await auth.confirmEmailChange(
            "11111111-1111-4111-8111-111111111111",
            code,
            {},
            "keep-this-sid"
        );
        assert.equal(revokedExcept, "keep-this-sid");
    });
});
