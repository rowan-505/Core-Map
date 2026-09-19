import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    resolveBrowserLoginClientType,
    sanitizeReturnTo,
    isAuthClientType,
} from "./auth-client.js";
import { AuthError, AuthService } from "./auth.service.js";
import type { AuthRepository, AuthUserRecord } from "./auth.repo.js";
import { hashPassword } from "./password.js";
import { hasDashboardAccess } from "../../plugins/auth.js";

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

const origins = {
    webAppUrl: "https://map.coremapmm.com",
    dashboardAppUrl: "https://admin.coremapmm.com",
};

describe("auth client type helpers", () => {
    it("resolves browser login client from trusted origin flag", () => {
        assert.equal(resolveBrowserLoginClientType(false), "web");
        assert.equal(resolveBrowserLoginClientType(true), "dashboard");
    });

    it("accepts only known AuthClientType values", () => {
        assert.equal(isAuthClientType("web"), true);
        assert.equal(isAuthClientType("dashboard"), true);
        assert.equal(isAuthClientType("android"), true);
        assert.equal(isAuthClientType("ios"), true);
        assert.equal(isAuthClientType("admin"), false);
        assert.equal(isAuthClientType("dashboard_admin"), false);
    });
});

describe("OAuth return destination allowlist", () => {
    it("allows map and dashboard production origins", () => {
        assert.equal(
            sanitizeReturnTo("https://map.coremapmm.com/auth/callback", "web", origins),
            "https://map.coremapmm.com/auth/callback"
        );
        assert.equal(
            sanitizeReturnTo("https://admin.coremapmm.com/login", "dashboard", origins),
            "https://admin.coremapmm.com/login"
        );
    });

    it("rejects unapproved external return destinations", () => {
        assert.equal(sanitizeReturnTo("https://evil.example/phish", "web", origins), null);
        assert.equal(
            sanitizeReturnTo("https://map.coremapmm.com.evil/x", "web", origins),
            null
        );
    });

    it("does not let dashboard client return to the public map origin", () => {
        assert.equal(
            sanitizeReturnTo("https://map.coremapmm.com/auth/callback", "dashboard", origins),
            null
        );
    });

    it("allows localhost development origins used by the repo", () => {
        const local = {
            webAppUrl: "http://localhost:5173",
            dashboardAppUrl: "http://localhost:3000",
        };
        assert.equal(
            sanitizeReturnTo("http://localhost:5173/auth/callback", "web", local),
            "http://localhost:5173/auth/callback"
        );
        assert.equal(
            sanitizeReturnTo("http://localhost:3000/login", "dashboard", local),
            "http://localhost:3000/login"
        );
    });
});

describe("login session client_type", () => {
    it("creates web sessions for public login", async () => {
        const passwordHash = await hashPassword("correct-password-12");
        let capturedClient: string | undefined;
        const auth = new AuthService(
            repo({
                findUserByEmail: async () => user({ password_hash: passwordHash, roles: ["user"] }),
                findActiveTotp: async () => null,
                touchLastLogin: async () => undefined,
                cleanupExpiredSessions: async () => undefined,
                createSession: async (input) => {
                    capturedClient = input.clientType;
                    return {
                        id: 1n,
                        public_id: "22222222-2222-4222-8222-222222222222",
                        token_family_id: "33333333-3333-4333-8333-333333333333",
                        client_type: input.clientType ?? "web",
                    };
                },
                recordSecurityEvent: async () => undefined,
            })
        );
        const outcome = await auth.login({ email: "ada@example.com" }, "correct-password-12", {
            clientType: "web",
        });
        assert.equal(outcome.kind, "session");
        assert.equal(capturedClient, "web");
    });

    it("allows admin dashboard login without MFA enrollment", async () => {
        const passwordHash = await hashPassword("correct-password-12");
        let capturedClient: string | undefined;
        const auth = new AuthService(
            repo({
                findUserByEmail: async () =>
                    user({ password_hash: passwordHash, roles: ["admin"], email_verified: true }),
                findActiveTotp: async () => null,
                touchLastLogin: async () => undefined,
                cleanupExpiredSessions: async () => undefined,
                createSession: async (input) => {
                    capturedClient = input.clientType;
                    return {
                        id: 1n,
                        public_id: "22222222-2222-4222-8222-222222222222",
                        token_family_id: "33333333-3333-4333-8333-333333333333",
                        client_type: input.clientType ?? "web",
                    };
                },
                recordSecurityEvent: async () => undefined,
            })
        );
        const outcome = await auth.login(
            { email: "ada@example.com" },
            "correct-password-12",
            { clientType: "dashboard" },
            { requireDashboard: true }
        );
        assert.equal(outcome.kind, "session");
        assert.equal(capturedClient, "dashboard");
    });

    it("blocks super_admin dashboard login without MFA enrollment", async () => {
        const passwordHash = await hashPassword("correct-password-12");
        let capturedClient: string | undefined;
        const auth = new AuthService(
            repo({
                findUserByEmail: async () =>
                    user({
                        password_hash: passwordHash,
                        roles: ["super_admin"],
                        email_verified: true,
                    }),
                findActiveTotp: async () => null,
                touchLastLogin: async () => undefined,
                cleanupExpiredSessions: async () => undefined,
                createSession: async (input) => {
                    capturedClient = input.clientType;
                    return {
                        id: 1n,
                        public_id: "22222222-2222-4222-8222-222222222222",
                        token_family_id: "33333333-3333-4333-8333-333333333333",
                        client_type: input.clientType ?? "web",
                    };
                },
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
        assert.equal(capturedClient, undefined);
    });

    it("creates dashboard sessions for viewer login without MFA", async () => {
        const passwordHash = await hashPassword("correct-password-12");
        let capturedClient: string | undefined;
        const auth = new AuthService(
            repo({
                findUserByEmail: async () =>
                    user({ password_hash: passwordHash, roles: ["viewer"], email_verified: true }),
                findActiveTotp: async () => null,
                touchLastLogin: async () => undefined,
                cleanupExpiredSessions: async () => undefined,
                createSession: async (input) => {
                    capturedClient = input.clientType;
                    return {
                        id: 1n,
                        public_id: "22222222-2222-4222-8222-222222222222",
                        token_family_id: "33333333-3333-4333-8333-333333333333",
                        client_type: input.clientType ?? "web",
                    };
                },
                recordSecurityEvent: async () => undefined,
            })
        );
        const outcome = await auth.login(
            { email: "ada@example.com" },
            "correct-password-12",
            { clientType: "dashboard" },
            { requireDashboard: true }
        );
        assert.equal(outcome.kind, "session");
        assert.equal(capturedClient, "dashboard");
    });

    it("rejects dashboard login without admin roles even if client_type is dashboard", async () => {
        const passwordHash = await hashPassword("correct-password-12");
        const auth = new AuthService(
            repo({
                findUserByEmail: async () => user({ password_hash: passwordHash, roles: ["user"] }),
                recordSecurityEvent: async () => undefined,
            })
        );
        await assert.rejects(
            () =>
                auth.login(
                    { email: "ada@example.com" },
                    "correct-password-12",
                    { clientType: "dashboard" },
                    { requireDashboard: true }
                ),
            (err: unknown) =>
                err instanceof AuthError &&
                err.statusCode === 403 &&
                err.code === "dashboard_forbidden"
        );
    });

    it("does not treat client_type as authorization", () => {
        assert.equal(hasDashboardAccess(["user"]), false);
        // Session metadata must never imply dashboard privilege.
        assert.equal(hasDashboardAccess(["user"]), false);
        assert.equal(hasDashboardAccess(["viewer"]), true);
        assert.equal(hasDashboardAccess(["admin"]), true);
    });
});

describe("oauth identity is client-independent", () => {
    it("looks up identities by provider + subject only", async () => {
        let lookedUp: { provider: string; subject: string } | null = null;
        const passwordHash = await hashPassword("unused");
        void passwordHash;
        const auth = new AuthService(
            repo({
                findIdentity: async (provider, subject) => {
                    lookedUp = { provider, subject };
                    return {
                        id: 1n,
                        userId: 1n,
                        user: {
                            id: 1n,
                            publicId: "11111111-1111-4111-8111-111111111111",
                        },
                    } as Awaited<ReturnType<AuthRepository["findIdentity"]>>;
                },
                findUserByPublicId: async () => user({ roles: ["user"], password_hash: null }),
                touchIdentityLogin: async () => undefined,
                touchLastLogin: async () => undefined,
                createSession: async (input) => ({
                    id: 1n,
                    public_id: "22222222-2222-4222-8222-222222222222",
                    token_family_id: "33333333-3333-4333-8333-333333333333",
                    client_type: input.clientType ?? "web",
                }),
                recordSecurityEvent: async () => undefined,
            })
        );
        // Access private path via completeOAuth would need full OAuth mocks.
        // Exercise resolve through login-adjacent identity key contract used by repo.
        const identity = await (
            auth as unknown as {
                resolveOAuthIdentity: (
                    id: {
                        provider: "google";
                        subject: string;
                        email: string | null;
                        emailVerified: boolean;
                        displayName: string | null;
                    },
                    ctx: { clientType: "web" },
                    meta: { client: "web"; returnTo: null }
                ) => Promise<unknown>;
            }
        ).resolveOAuthIdentity(
            {
                provider: "google",
                subject: "google-sub-123",
                email: "ada@example.com",
                emailVerified: true,
                displayName: "Ada",
            },
            { clientType: "web" },
            { client: "web", returnTo: null }
        );
        void identity;
        assert.deepEqual(lookedUp, { provider: "google", subject: "google-sub-123" });

        lookedUp = null;
        await (
            auth as unknown as {
                resolveOAuthIdentity: (
                    id: {
                        provider: "google";
                        subject: string;
                        email: string | null;
                        emailVerified: boolean;
                        displayName: string | null;
                    },
                    ctx: { clientType: "dashboard" },
                    meta: { client: "dashboard"; returnTo: null }
                ) => Promise<unknown>;
            }
        ).resolveOAuthIdentity(
            {
                provider: "google",
                subject: "google-sub-123",
                email: "ada@example.com",
                emailVerified: true,
                displayName: "Ada",
            },
            { clientType: "dashboard" },
            { client: "dashboard", returnTo: null }
        );
        assert.deepEqual(lookedUp, { provider: "google", subject: "google-sub-123" });
    });
});
