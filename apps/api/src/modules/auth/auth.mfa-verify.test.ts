import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import Fastify from "fastify";

import { resetApiEnvCacheForTests } from "../../config/env.js";
import authPlugin from "../../plugins/auth.js";
import { handleAuthError, verifyPurposeToken } from "./auth-http-error.js";
import { AuthError, AuthService } from "./auth.service.js";
import type { AuthRepository, AuthUserRecord } from "./auth.repo.js";
import { encryptSecret } from "./mfa-crypto.js";

const MFA_KEY = "test-mfa-key-material-32chars!!";

function user(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
    return {
        id: "25",
        public_id: "11111111-1111-4111-8111-111111111111",
        email: "ada@example.com",
        display_name: "Ada",
        password_hash: "hash",
        is_active: true,
        account_status: "active",
        email_verified: true,
        roles: ["super_admin"],
        ...overrides,
    };
}

function repo(partial: Partial<AuthRepository>): AuthRepository {
    return partial as AuthRepository;
}

describe("MFA verify decrypt failures", () => {
    const previousKey = process.env.AUTH_MFA_ENCRYPTION_KEY;

    afterEach(() => {
        if (previousKey === undefined) {
            delete process.env.AUTH_MFA_ENCRYPTION_KEY;
        } else {
            process.env.AUTH_MFA_ENCRYPTION_KEY = previousKey;
        }
        resetApiEnvCacheForTests();
    });

    it("returns 503 when the stored secret cannot be decrypted", async () => {
        process.env.AUTH_MFA_ENCRYPTION_KEY = MFA_KEY;
        resetApiEnvCacheForTests();
        const auth = new AuthService(
            repo({
                findUserByPublicId: async () => user(),
                findActiveTotp: async () =>
                    ({
                        id: 1n,
                        secretEncrypted: encryptSecret("JBSWY3DPEHPK3PXP", "a-different-mfa-key"),
                    }) as never,
            })
        );
        try {
            await auth.verifyMfa(user().public_id, "123456");
            assert.fail("expected AuthError");
        } catch (error) {
            assert.ok(error instanceof AuthError);
            assert.equal(error.statusCode, 503);
            assert.match(error.message, /administrator/i);
        }
    });
});

describe("POST /auth/mfa/verify JWT failures", () => {
    const previous = {
        JWT_SECRET: process.env.JWT_SECRET,
        AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
        NODE_ENV: process.env.NODE_ENV,
    };

    afterEach(async () => {
        if (previous.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previous.JWT_SECRET;
        if (previous.AUTH_JWT_SECRET === undefined) delete process.env.AUTH_JWT_SECRET;
        else process.env.AUTH_JWT_SECRET = previous.AUTH_JWT_SECRET;
        if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous.NODE_ENV;
    });

    it("returns 401 for a malformed MFA token instead of 500", async () => {
        process.env.JWT_SECRET = "mfa-verify-test-secret";
        delete process.env.AUTH_JWT_SECRET;
        process.env.NODE_ENV = "test";

        const app = Fastify();
        app.setErrorHandler((error, _request, reply) => {
            const err = error as { statusCode?: number; message?: string };
            const statusCode =
                typeof err.statusCode === "number" ? err.statusCode : 500;
            return reply.code(statusCode).send({
                message:
                    statusCode >= 500
                        ? "We could not load this data right now. Please try again in a moment."
                        : err.message,
            });
        });
        try {
            await app.register(authPlugin);
            app.post("/auth/mfa/verify", async (request, reply) => {
                const body = request.body as { mfaToken?: string; code?: string };
                try {
                    verifyPurposeToken(
                        () => app.jwt.verify<{ sub: string; purpose?: string }>(body.mfaToken ?? ""),
                        "mfa",
                        "Invalid or expired MFA token"
                    );
                    return reply.send({ ok: true });
                } catch (error) {
                    return handleAuthError(error, reply);
                }
            });
            await app.ready();

            const response = await app.inject({
                method: "POST",
                url: "/auth/mfa/verify",
                payload: { mfaToken: "not-a-jwt", code: "123456" },
            });
            assert.equal(response.statusCode, 401);
            const body = response.json() as { message?: string };
            assert.equal(body.message, "Invalid or expired MFA token");
        } finally {
            await app.close();
        }
    });
});
