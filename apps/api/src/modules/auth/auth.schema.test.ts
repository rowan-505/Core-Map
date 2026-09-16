import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    registerBodySchema,
    loginBodySchema,
    sessionResponseSchema,
    changePasswordBodySchema,
    changeEmailBodySchema,
} from "./auth.schema.js";

describe("auth schemas", () => {
    it("rejects whitespace-only register passwords", () => {
        const parsed = registerBodySchema.safeParse({
            email: "a@example.com",
            displayName: "Ada",
            password: "        ",
        });
        assert.equal(parsed.success, false);
    });

    it("omits internal numeric ids from session users", () => {
        const parsed = sessionResponseSchema.parse({
            accessToken: "aaa",
            expiresIn: "15m",
            user: {
                public_id: "11111111-1111-4111-8111-111111111111",
                email: "a@example.com",
                display_name: "Ada",
                roles: ["user"],
            },
        });
        assert.equal("id" in parsed.user, false);
    });

    it("allows login without username when email is present", () => {
        const parsed = loginBodySchema.safeParse({ email: "a@example.com", password: "secret" });
        assert.equal(parsed.success, true);
    });

    it("accepts change-password field names currentPassword/newPassword", () => {
        const parsed = changePasswordBodySchema.safeParse({
            currentPassword: "old-secret",
            newPassword: "new-secret-12",
        });
        assert.equal(parsed.success, true);
    });

    it("rejects missing current password on change", () => {
        const parsed = changePasswordBodySchema.safeParse({
            currentPassword: "",
            newPassword: "new-secret-12",
        });
        assert.equal(parsed.success, false);
    });

    it("rejects numeric-only email change targets", () => {
        const parsed = changeEmailBodySchema.safeParse({
            password: "secret",
            newEmail: "294352",
        });
        assert.equal(parsed.success, false);
    });

    it("accepts a normal email change payload", () => {
        const parsed = changeEmailBodySchema.safeParse({
            password: "secret",
            newEmail: "new@example.com",
        });
        assert.equal(parsed.success, true);
    });
});
