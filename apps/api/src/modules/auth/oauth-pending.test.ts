import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AuthError, AuthService } from "./auth.service.js";
import type { AuthRepository, AuthUserRecord } from "./auth.repo.js";
import { hashRefreshToken } from "./refresh-token.js";
import type { NormalizedIdentity } from "./oauth/types.js";
import { hashOtp } from "../../lib/security/otp.js";

function user(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
    return {
        id: "10",
        public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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

function profileStub(publicId: string) {
    return {
        public_id: publicId,
        email: "new@example.com",
        display_name: "Ada",
        phone: null,
        email_verified: true,
        account_status: "active",
        primary_region_id: null,
        preferred_language: "en",
        total_points: 0,
        roles: ["user"],
    };
}

const facebookNoEmail: NormalizedIdentity = {
    provider: "facebook",
    subject: "fb-user-99",
    email: null,
    emailVerified: false,
    displayName: "FB User",
};

const facebookWithEmail: NormalizedIdentity = {
    provider: "facebook",
    subject: "fb-user-88",
    email: "fb@example.com",
    emailVerified: true,
    displayName: "FB User",
};

const googleIdentity: NormalizedIdentity = {
    provider: "google",
    subject: "google-sub-1",
    email: "ada@example.com",
    emailVerified: true,
    displayName: "Ada",
};

type Resolve = (
    identity: NormalizedIdentity,
    context: object,
    meta: { client: "web"; returnTo: null }
) => Promise<
    | { kind: "session"; session: { user: { public_id: string } } }
    | { kind: "complete_profile"; flowToken: string }
>;

function resolve(auth: AuthService): Resolve {
    return (auth as unknown as { resolveOAuthIdentity: Resolve }).resolveOAuthIdentity.bind(auth);
}

describe("oauth existing identity login", () => {
    it("logs in existing Google identity", async () => {
        const auth = new AuthService(
            repo({
                findIdentity: async () =>
                    ({
                        id: 1n,
                        userId: 10n,
                        user: { publicId: user().public_id },
                    }) as never,
                findUserByPublicId: async () => user(),
                touchIdentityLogin: async () => undefined,
                touchLastLogin: async () => undefined,
                createSession: async () => ({
                    id: 1n,
                    public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    token_family_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    client_type: "web",
                }),
                recordSecurityEvent: async () => undefined,
            })
        );
        const result = await resolve(auth)(googleIdentity, {}, { client: "web", returnTo: null });
        assert.equal(result.kind, "session");
        if (result.kind === "session") {
            assert.equal(result.session.user.public_id, user().public_id);
        }
    });

    it("logs in existing Facebook identity even when provider returns no email", async () => {
        const auth = new AuthService(
            repo({
                findIdentity: async () =>
                    ({
                        id: 2n,
                        userId: 10n,
                        user: { publicId: user().public_id },
                    }) as never,
                findUserByPublicId: async () => user({ password_hash: null }),
                touchIdentityLogin: async () => undefined,
                touchLastLogin: async () => undefined,
                createSession: async () => ({
                    id: 1n,
                    public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    token_family_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    client_type: "web",
                }),
                recordSecurityEvent: async () => undefined,
            })
        );
        const result = await resolve(auth)(facebookNoEmail, {}, { client: "web", returnTo: null });
        assert.equal(result.kind, "session");
    });

    it("rejects disabled users on existing identity login", async () => {
        const auth = new AuthService(
            repo({
                findIdentity: async () =>
                    ({
                        id: 1n,
                        userId: 10n,
                        user: { publicId: user().public_id },
                    }) as never,
                findUserByPublicId: async () => user({ is_active: false }),
                recordSecurityEvent: async () => undefined,
            })
        );
        await assert.rejects(
            () => resolve(auth)(facebookNoEmail, {}, { client: "web", returnTo: null }),
            /inactive/i
        );
    });
});

describe("oauth new identity email paths", () => {
    it("creates account for new Google with unused verified email", async () => {
        let createdIdentity = false;
        const created = user({
            id: "99",
            public_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            email: "new@example.com",
            password_hash: null,
        });
        const auth = new AuthService(
            repo({
                findIdentity: async () => null,
                findUserByEmail: async () => null,
                createPublicUser: async () => profileStub(created.public_id) as never,
                findUserByPublicId: async () => created,
                createIdentity: async () => {
                    createdIdentity = true;
                },
                createSession: async () => ({
                    id: 1n,
                    public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    token_family_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    client_type: "web",
                }),
                touchLastLogin: async () => undefined,
                recordSecurityEvent: async () => undefined,
            })
        );
        const result = await resolve(auth)(
            { ...googleIdentity, email: "new@example.com" },
            {},
            { client: "web", returnTo: null }
        );
        assert.equal(result.kind, "session");
        assert.equal(createdIdentity, true);
    });

    it("returns link_required for new Google with existing email", async () => {
        const auth = new AuthService(
            repo({
                findIdentity: async () => null,
                findUserByEmail: async () => user(),
                recordSecurityEvent: async () => undefined,
            })
        );
        await assert.rejects(
            () => resolve(auth)(googleIdentity, {}, { client: "web", returnTo: null }),
            (err: unknown) => err instanceof AuthError && err.code === "link_required"
        );
    });

    it("creates account for new Facebook with unused email", async () => {
        let createdIdentity = false;
        const created = user({
            id: "77",
            public_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            email: "fb@example.com",
            password_hash: null,
        });
        const auth = new AuthService(
            repo({
                findIdentity: async () => null,
                findUserByEmail: async () => null,
                createPublicUser: async () => profileStub(created.public_id) as never,
                findUserByPublicId: async () => created,
                createIdentity: async () => {
                    createdIdentity = true;
                },
                createSession: async () => ({
                    id: 1n,
                    public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    token_family_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    client_type: "web",
                }),
                touchLastLogin: async () => undefined,
                recordSecurityEvent: async () => undefined,
            })
        );
        const result = await resolve(auth)(facebookWithEmail, {}, { client: "web", returnTo: null });
        assert.equal(result.kind, "session");
        assert.equal(createdIdentity, true);
    });

    it("returns link_required for new Facebook with existing email", async () => {
        const auth = new AuthService(
            repo({
                findIdentity: async () => null,
                findUserByEmail: async () => user({ email: "fb@example.com" }),
                recordSecurityEvent: async () => undefined,
            })
        );
        await assert.rejects(
            () => resolve(auth)(facebookWithEmail, {}, { client: "web", returnTo: null }),
            (err: unknown) => err instanceof AuthError && err.code === "link_required"
        );
    });

    it("creates pending registration for new Facebook with no email", async () => {
        let pending: { provider: string; providerSubject: string } | null = null;
        const auth = new AuthService(
            repo({
                findIdentity: async () => null,
                createOAuthPending: async (input) => {
                    pending = { provider: input.provider, providerSubject: input.providerSubject };
                    return { id: 1n, public_id: "pppppppp-pppp-4ppp-8ppp-pppppppppppp" };
                },
                recordSecurityEvent: async () => undefined,
            })
        );
        const result = await resolve(auth)(facebookNoEmail, {}, { client: "web", returnTo: null });
        assert.equal(result.kind, "complete_profile");
        if (result.kind === "complete_profile") {
            assert.ok(result.flowToken.length > 20);
        }
        assert.deepEqual(pending, { provider: "facebook", providerSubject: "fb-user-99" });
    });

    it("does not invent placeholder emails for Facebook without email", async () => {
        let createdUser = false;
        const auth = new AuthService(
            repo({
                findIdentity: async () => null,
                createPublicUser: async () => {
                    createdUser = true;
                    return profileStub("x") as never;
                },
                createOAuthPending: async () => ({
                    id: 1n,
                    public_id: "pppppppp-pppp-4ppp-8ppp-pppppppppppp",
                }),
                recordSecurityEvent: async () => undefined,
            })
        );
        const result = await resolve(auth)(facebookNoEmail, {}, { client: "web", returnTo: null });
        assert.equal(result.kind, "complete_profile");
        assert.equal(createdUser, false);
    });
});

describe("oauth complete-profile pending flow", () => {
    const OTP_SECRET = "test-otp-secret-for-pending-flow";

    function pendingRow(overrides: Record<string, unknown> = {}) {
        return {
            id: 5n,
            public_id: "pppppppp-pppp-4ppp-8ppp-pppppppppppp",
            provider: "facebook",
            provider_subject: "fb-user-99",
            provider_name: "FB User",
            provider_email: null,
            provider_email_verified: false,
            client: "web",
            return_to: null,
            email_pending: null as string | null,
            otp_hash: null as string | null,
            otp_expires_at: null as Date | null,
            otp_attempts_count: 0,
            otp_max_attempts: 5,
            expires_at: new Date(Date.now() + 10 * 60 * 1000),
            ...overrides,
        };
    }

    it("rejects invalid email on send-otp", async () => {
        const auth = new AuthService(
            repo({
                findActiveOAuthPendingByTokenHash: async () => pendingRow(),
            }),
            {
                emailService: { sendEmailVerificationOtp: async () => undefined } as never,
                otpSecret: OTP_SECRET,
                ttlMinutes: 10,
                maxAttempts: 5,
            }
        );
        await assert.rejects(
            () => auth.sendCompleteProfileOtp("a".repeat(32), "not-an-email"),
            /valid email/i
        );
    });

    it("rejects expired pending flow", async () => {
        const auth = new AuthService(
            repo({
                findActiveOAuthPendingByTokenHash: async () => null,
            }),
            {
                emailService: { sendEmailVerificationOtp: async () => undefined } as never,
                otpSecret: OTP_SECRET,
                ttlMinutes: 10,
                maxAttempts: 5,
            }
        );
        await assert.rejects(
            () => auth.sendCompleteProfileOtp("a".repeat(32), "new@example.com"),
            (err: unknown) => err instanceof AuthError && err.code === "oauth_expired"
        );
    });

    it("rejects tampered opaque token", async () => {
        const auth = new AuthService(
            repo({
                findActiveOAuthPendingByTokenHash: async () => null,
            }),
            {
                emailService: { sendEmailVerificationOtp: async () => undefined } as never,
                otpSecret: OTP_SECRET,
                ttlMinutes: 10,
                maxAttempts: 5,
            }
        );
        await assert.rejects(
            () => auth.sendCompleteProfileOtp("tampered-token-value-xxxxxx", "new@example.com"),
            (err: unknown) => err instanceof AuthError && err.code === "oauth_expired"
        );
    });

    it("send-otp returns existing_account_link_required without creating user", async () => {
        let created = false;
        const auth = new AuthService(
            repo({
                findActiveOAuthPendingByTokenHash: async () => pendingRow(),
                findUserByEmail: async () => user({ email: "taken@example.com" }),
                consumeOAuthPendingAndCreateUser: async () => {
                    created = true;
                    return { userPublicId: "x", userId: 1n };
                },
            }),
            {
                emailService: { sendEmailVerificationOtp: async () => undefined } as never,
                otpSecret: OTP_SECRET,
                ttlMinutes: 10,
                maxAttempts: 5,
            }
        );
        await assert.rejects(
            () => auth.sendCompleteProfileOtp("a".repeat(32), "taken@example.com"),
            (err: unknown) =>
                err instanceof AuthError && err.code === "existing_account_link_required"
        );
        assert.equal(created, false);
    });

    it("requires OTP before finishing account creation", async () => {
        const auth = new AuthService(
            repo({
                findActiveOAuthPendingByTokenHash: async () => pendingRow(),
                findUserByEmail: async () => null,
            }),
            {
                emailService: { sendEmailVerificationOtp: async () => undefined } as never,
                otpSecret: OTP_SECRET,
                ttlMinutes: 10,
                maxAttempts: 5,
            }
        );
        await assert.rejects(
            () => auth.verifyCompleteProfile("a".repeat(32), "new@example.com", "123456"),
            /Request a verification code/
        );
    });

    it("finishes account creation after OTP for unused email", async () => {
        const code = "123456";
        const otpHash = hashOtp(code, OTP_SECRET);
        let consumed = false;
        const created = user({
            id: "55",
            public_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            email: "new@example.com",
            password_hash: null,
            email_verified: true,
        });
        const auth = new AuthService(
            repo({
                findActiveOAuthPendingByTokenHash: async () =>
                    pendingRow({
                        email_pending: "new@example.com",
                        otp_hash: otpHash,
                        otp_expires_at: new Date(Date.now() + 60_000),
                    }),
                findUserByEmail: async () => null,
                findIdentity: async () => null,
                consumeOAuthPendingAndCreateUser: async () => {
                    consumed = true;
                    return { userPublicId: created.public_id, userId: BigInt(created.id) };
                },
                findUserByPublicId: async () => created,
                createSession: async () => ({
                    id: 1n,
                    public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    token_family_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    client_type: "web",
                }),
                recordSecurityEvent: async () => undefined,
            }),
            {
                emailService: { sendEmailVerificationOtp: async () => undefined } as never,
                otpSecret: OTP_SECRET,
                ttlMinutes: 10,
                maxAttempts: 5,
            }
        );
        const result = await auth.verifyCompleteProfile("a".repeat(32), "new@example.com", code);
        assert.equal(result.kind, "session");
        assert.equal(consumed, true);
    });

    it("returns existing_account_link_required after OTP when email taken", async () => {
        const code = "123456";
        const otpHash = hashOtp(code, OTP_SECRET);
        let consumed = false;
        const auth = new AuthService(
            repo({
                findActiveOAuthPendingByTokenHash: async () =>
                    pendingRow({
                        email_pending: "taken@example.com",
                        otp_hash: otpHash,
                        otp_expires_at: new Date(Date.now() + 60_000),
                    }),
                findUserByEmail: async () => user({ email: "taken@example.com" }),
                invalidateActiveOAuthPending: async () => undefined,
                consumeOAuthPendingAndCreateUser: async () => {
                    consumed = true;
                    return { userPublicId: "x", userId: 1n };
                },
                recordSecurityEvent: async () => undefined,
            }),
            {
                emailService: { sendEmailVerificationOtp: async () => undefined } as never,
                otpSecret: OTP_SECRET,
                ttlMinutes: 10,
                maxAttempts: 5,
            }
        );
        const result = await auth.verifyCompleteProfile("a".repeat(32), "taken@example.com", code);
        assert.equal(result.kind, "existing_account_link_required");
        assert.equal(consumed, false);
    });

    it("rejects consumed pending reuse", async () => {
        const auth = new AuthService(
            repo({
                findActiveOAuthPendingByTokenHash: async () => null,
            }),
            {
                emailService: { sendEmailVerificationOtp: async () => undefined } as never,
                otpSecret: OTP_SECRET,
                ttlMinutes: 10,
                maxAttempts: 5,
            }
        );
        await assert.rejects(
            () => auth.verifyCompleteProfile("a".repeat(32), "new@example.com", "123456"),
            (err: unknown) => err instanceof AuthError && err.code === "oauth_expired"
        );
    });

    it("rejects wrong OTP and does not create user", async () => {
        let created = false;
        const auth = new AuthService(
            repo({
                findActiveOAuthPendingByTokenHash: async () =>
                    pendingRow({
                        email_pending: "new@example.com",
                        otp_hash: hashOtp("123456", OTP_SECRET),
                        otp_expires_at: new Date(Date.now() + 60_000),
                    }),
                incrementOAuthPendingOtpAttempts: async () => true,
                consumeOAuthPendingAndCreateUser: async () => {
                    created = true;
                    return { userPublicId: "x", userId: 1n };
                },
            }),
            {
                emailService: { sendEmailVerificationOtp: async () => undefined } as never,
                otpSecret: OTP_SECRET,
                ttlMinutes: 10,
                maxAttempts: 5,
            }
        );
        await assert.rejects(
            () => auth.verifyCompleteProfile("a".repeat(32), "new@example.com", "000000"),
            /Invalid verification code/
        );
        assert.equal(created, false);
    });

    it("stores pending token hashed", async () => {
        let storedHash: string | null = null;
        const auth = new AuthService(
            repo({
                findIdentity: async () => null,
                createOAuthPending: async (input) => {
                    storedHash = input.tokenHash;
                    return { id: 1n, public_id: "pppppppp-pppp-4ppp-8ppp-pppppppppppp" };
                },
                recordSecurityEvent: async () => undefined,
            })
        );
        const result = await resolve(auth)(facebookNoEmail, {}, { client: "web", returnTo: null });
        assert.equal(result.kind, "complete_profile");
        if (result.kind === "complete_profile") {
            assert.notEqual(storedHash, result.flowToken);
            assert.equal(storedHash, hashRefreshToken(result.flowToken));
        }
    });
});
