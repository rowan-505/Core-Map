import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FastifyReply } from "fastify";

import { AuthError } from "./auth.service.js";
import {
    handleAuthError,
    isJwtVerifyError,
    verifyPurposeToken,
} from "./auth-http-error.js";
import { PasswordPolicyError } from "./password-policy.js";

function captureReply() {
    const captured: { statusCode?: number; body?: unknown } = {};
    const reply = {
        code(statusCode: number) {
            captured.statusCode = statusCode;
            return this;
        },
        send(body: unknown) {
            captured.body = body;
            return this;
        },
    } as unknown as FastifyReply;
    return { captured, reply };
}

describe("MFA purpose token", () => {
    it("returns sub when purpose matches", () => {
        const sub = verifyPurposeToken(
            () => ({ sub: "11111111-1111-4111-8111-111111111111", purpose: "mfa" }),
            "mfa",
            "Invalid or expired MFA token"
        );
        assert.equal(sub, "11111111-1111-4111-8111-111111111111");
    });

    it("maps JWT verify failures to 401 AuthError", () => {
        const jwtError = Object.assign(new Error("The token is malformed."), {
            code: "FAST_JWT_MALFORMED",
        });
        assert.equal(isJwtVerifyError(jwtError), true);
        try {
            verifyPurposeToken(
                () => {
                    throw jwtError;
                },
                "mfa",
                "Invalid or expired MFA token"
            );
            assert.fail("expected AuthError");
        } catch (error) {
            assert.ok(error instanceof AuthError);
            assert.equal(error.statusCode, 401);
            assert.equal(error.message, "Invalid or expired MFA token");
        }
    });

    it("rejects a token with the wrong purpose", () => {
        try {
            verifyPurposeToken(
                () => ({ sub: "11111111-1111-4111-8111-111111111111", purpose: "access" }),
                "mfa",
                "Invalid or expired MFA token"
            );
            assert.fail("expected AuthError");
        } catch (error) {
            assert.ok(error instanceof AuthError);
            assert.equal(error.statusCode, 401);
        }
    });
});

describe("handleAuthError", () => {
    it("sends 401 for FAST_JWT errors instead of rethrowing", () => {
        const { captured, reply } = captureReply();
        const jwtError = Object.assign(new Error("The token is malformed."), {
            code: "FAST_JWT_MALFORMED",
        });
        handleAuthError(jwtError, reply);
        assert.equal(captured.statusCode, 401);
        assert.deepEqual(captured.body, {
            message: "Invalid or expired token",
            code: "invalid_token",
        });
    });

    it("keeps AuthError status codes", () => {
        const { captured, reply } = captureReply();
        handleAuthError(new AuthError("Invalid verification code", 400), reply);
        assert.equal(captured.statusCode, 400);
        assert.deepEqual(captured.body, { message: "Invalid verification code", code: undefined });
    });

    it("keeps password policy as 400", () => {
        const { captured, reply } = captureReply();
        handleAuthError(new PasswordPolicyError("Password is too short"), reply);
        assert.equal(captured.statusCode, 400);
        assert.deepEqual(captured.body, {
            message: "Password is too short",
            code: "password_policy",
        });
    });
});
