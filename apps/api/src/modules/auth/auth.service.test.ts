import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AuthError, AuthService, FAMILY_REUSE_GRACE_MS } from "./auth.service.js";
import type { AuthRepository, AuthUserRecord, ActiveSession } from "./auth.repo.js";
import { hashRefreshToken } from "./refresh-token.js";

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

describe("auth service refresh rotation", () => {
    it("issues a new token when atomic rotate succeeds", async () => {
        const session: ActiveSession = {
            id: 1n,
            public_id: "22222222-2222-4222-8222-222222222222",
            token_family_id: "33333333-3333-4333-8333-333333333333",
            user: user(),
        };
        const auth = new AuthService(
            repo({
                rotateSessionAtomic: async () => session,
                cleanupExpiredSessions: async () => undefined,
            })
        );
        const result = await auth.refresh("old-token");
        assert.equal(result.user.public_id, session.user.public_id);
        assert.equal(result.accessTokenClaims.sid, session.public_id);
        assert.ok(result.refreshToken.length > 20);
    });

    it("revokes the family when a reused token is older than the grace window", async () => {
        let revoked = "";
        const auth = new AuthService(
            repo({
                rotateSessionAtomic: async () => null,
                findSessionByPreviousHash: async () => ({
                    id: 1n,
                    token_family_id: "family-1",
                    last_used_at: new Date(Date.now() - FAMILY_REUSE_GRACE_MS - 1000),
                }),
                revokeFamily: async (family) => {
                    revoked = family;
                    return 1;
                },
                recordSecurityEvent: async () => undefined,
            })
        );
        await assert.rejects(() => auth.refresh("stolen"), /Session revoked/);
        assert.equal(revoked, "family-1");
    });

    it("does not revoke the family during the concurrent grace window", async () => {
        let revoked = false;
        const auth = new AuthService(
            repo({
                rotateSessionAtomic: async () => null,
                findSessionByPreviousHash: async () => ({
                    id: 1n,
                    token_family_id: "family-1",
                    last_used_at: new Date(),
                }),
                revokeFamily: async () => {
                    revoked = true;
                    return 1;
                },
            })
        );
        await assert.rejects(() => auth.refresh("racy"), AuthError);
        assert.equal(revoked, false);
    });
});

describe("auth service login", () => {
    it("rejects oauth-only accounts on password login", async () => {
        const auth = new AuthService(
            repo({
                findUserByEmail: async () => user({ password_hash: null }),
                recordSecurityEvent: async () => undefined,
            })
        );
        await assert.rejects(
            () => auth.login({ email: "ada@example.com" }, "password"),
            /Invalid email or password/
        );
    });
});

describe("auth service change password", () => {
    it("rejects wrong current password", async () => {
        const { hashPassword } = await import("./password.js");
        const passwordHash = await hashPassword("correct-password-12");
        const auth = new AuthService(
            repo({
                findUserByPublicId: async () => user({ password_hash: passwordHash, roles: ["user"] }),
                recordSecurityEvent: async () => undefined,
            })
        );
        await assert.rejects(
            () =>
                auth.changePassword(
                    "11111111-1111-4111-8111-111111111111",
                    "wrong-password",
                    "brand-new-password",
                    "sid"
                ),
            /Current password is incorrect/
        );
    });

    it("rejects privileged passwords under 12 characters", async () => {
        const { hashPassword } = await import("./password.js");
        const passwordHash = await hashPassword("correct-password-12");
        const auth = new AuthService(
            repo({
                findUserByPublicId: async () =>
                    user({ password_hash: passwordHash, roles: ["super_admin"] }),
                recordSecurityEvent: async () => undefined,
            })
        );
        await assert.rejects(
            () =>
                auth.changePassword(
                    "11111111-1111-4111-8111-111111111111",
                    "correct-password-12",
                    "short-pass",
                    "sid"
                ),
            /at least 12/
        );
    });

    it("rejects when new password equals current", async () => {
        const { hashPassword } = await import("./password.js");
        const passwordHash = await hashPassword("same-password-12");
        const auth = new AuthService(
            repo({
                findUserByPublicId: async () => user({ password_hash: passwordHash, roles: ["user"] }),
                recordSecurityEvent: async () => undefined,
            })
        );
        await assert.rejects(
            () =>
                auth.changePassword(
                    "11111111-1111-4111-8111-111111111111",
                    "same-password-12",
                    "same-password-12",
                    "sid"
                ),
            /different from the current/
        );
    });

    it("revokes other sessions after a successful change", async () => {
        const { hashPassword } = await import("./password.js");
        const passwordHash = await hashPassword("correct-password-12");
        let revokedExcept: string | undefined;
        const auth = new AuthService(
            repo({
                findUserByPublicId: async () => user({ password_hash: passwordHash, roles: ["user"] }),
                updatePasswordHash: async () => undefined,
                revokeAllUserSessions: async (_userId, _reason, exceptPublicId) => {
                    revokedExcept = exceptPublicId;
                    return 2;
                },
                recordSecurityEvent: async () => undefined,
            })
        );
        await auth.changePassword(
            "11111111-1111-4111-8111-111111111111",
            "correct-password-12",
            "brand-new-password",
            "keep-this-sid"
        );
        assert.equal(revokedExcept, "keep-this-sid");
    });
});

describe("auth service refresh stays on one session", () => {
    it("does not call createSession during refresh", async () => {
        let created = false;
        const session: ActiveSession = {
            id: 1n,
            public_id: "22222222-2222-4222-8222-222222222222",
            token_family_id: "33333333-3333-4333-8333-333333333333",
            user: user(),
        };
        const auth = new AuthService(
            repo({
                rotateSessionAtomic: async () => session,
                cleanupExpiredSessions: async () => undefined,
                createSession: async () => {
                    created = true;
                    return {
                        id: 9n,
                        public_id: "99999999-9999-4999-8999-999999999999",
                        token_family_id: "family",
                        client_type: "web",
                    };
                },
            })
        );
        await auth.refresh("old-token");
        assert.equal(created, false);
    });
});

describe("refresh hash helper used by rotation", () => {
    it("never stores the raw token", () => {
        assert.equal(hashRefreshToken("raw-token") === "raw-token", false);
        assert.notEqual(hashRefreshToken("raw-token"), "raw-token");
    });
});
