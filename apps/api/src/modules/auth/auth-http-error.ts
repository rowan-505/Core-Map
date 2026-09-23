import type { FastifyReply } from "fastify";

import { AuthError } from "./auth.service.js";
import { PasswordPolicyError } from "./password-policy.js";

export function isJwtVerifyError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" && code.startsWith("FAST_JWT_");
}

export function verifyPurposeToken(
    verify: () => { sub?: string; purpose?: string },
    purpose: "mfa" | "mfa_enroll",
    invalidMessage: string
): string {
    let claims: { sub?: string; purpose?: string };
    try {
        claims = verify();
    } catch (error) {
        if (error instanceof AuthError) {
            throw error;
        }
        throw new AuthError(invalidMessage, 401);
    }
    if (claims.purpose !== purpose || !claims.sub) {
        throw new AuthError(invalidMessage, 401);
    }
    return claims.sub;
}

export function handleAuthError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof AuthError) {
        return reply.code(error.statusCode).send({ message: error.message, code: error.code });
    }
    if (error instanceof PasswordPolicyError) {
        return reply.code(400).send({ message: error.message, code: "password_policy" });
    }
    if (isJwtVerifyError(error)) {
        return reply.code(401).send({ message: "Invalid or expired token", code: "invalid_token" });
    }
    if (
        error instanceof Error &&
        "statusCode" in error &&
        typeof (error as { statusCode?: unknown }).statusCode === "number"
    ) {
        const statusCode = (error as { statusCode: number }).statusCode;
        const maybeCode = (error as { code?: unknown }).code;
        const code = typeof maybeCode === "string" ? maybeCode : undefined;
        return reply.code(statusCode).send({ message: error.message, code });
    }
    throw error;
}
