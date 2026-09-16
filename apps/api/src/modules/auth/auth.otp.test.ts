import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AuthError, AuthService } from "./auth.service.js";
import type { AuthRepository, EmailOtpRecord } from "./auth.repo.js";
import { hashOtp } from "../../lib/security/otp.js";

function repo(partial: Partial<AuthRepository>): AuthRepository {
    return partial as AuthRepository;
}

describe("otp consume races", () => {
    it("treats a lost consume race as expired", async () => {
        const otp: EmailOtpRecord = {
            id: 9n,
            otp_hash: hashOtp("123456", "otp-secret"),
            attempts_count: 0,
            max_attempts: 5,
            expires_at: new Date(Date.now() + 60_000),
            consumed_at: null,
            created_at: new Date(),
        };
        const auth = new AuthService(
            repo({
                findVerificationUserByPublicId: async () => ({
                    id: 1n,
                    email: "ada@example.com",
                    email_verified: false,
                    is_active: true,
                    account_status: "active",
                    roles: ["user"],
                }),
                findLatestUnconsumedOtp: async () => otp,
                markEmailVerified: async () => false,
            }),
            {
                emailService: {
                    isConfigured: () => true,
                    sendEmailVerificationOtp: async () => undefined,
                    sendPasswordReset: async () => undefined,
                    sendPasswordChanged: async () => undefined,
                    sendEmailChangedNotice: async () => undefined,
                },
                otpSecret: "otp-secret",
                ttlMinutes: 10,
                maxAttempts: 5,
            }
        );
        await assert.rejects(
            () => auth.verifyEmailOtp("11111111-1111-4111-8111-111111111111", "123456"),
            (error: unknown) => error instanceof AuthError && error.statusCode === 400
        );
    });
});
