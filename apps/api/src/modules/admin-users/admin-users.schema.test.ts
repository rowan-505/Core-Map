import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ADMIN_MANAGED_ROLE_CODES,
    createUserBodySchema,
    resetUserPasswordBodySchema,
    updateUserProfileBodySchema,
} from "./admin-users.schema.js";

describe("admin user account schemas", () => {
    it("accepts each managed role for account creation", () => {
        for (const roleCode of ADMIN_MANAGED_ROLE_CODES) {
            const result = createUserBodySchema.safeParse({
                email: "New.User@Example.com",
                displayName: "New User",
                password: "example-password",
                roleCode,
            });
            assert.equal(result.success, true, roleCode);
        }
    });

    it("rejects unknown roles and short passwords", () => {
        assert.equal(
            createUserBodySchema.safeParse({
                email: "user@example.com",
                displayName: "User",
                password: "short",
                roleCode: "editor",
            }).success,
            false
        );
    });

    it("requires at least one profile field", () => {
        assert.equal(updateUserProfileBodySchema.safeParse({}).success, false);
        assert.equal(
            updateUserProfileBodySchema.safeParse({
                phone: null,
                primaryRegionId: null,
                emailVerified: true,
            }).success,
            true
        );
    });

    it("validates manual reset passwords", () => {
        assert.equal(resetUserPasswordBodySchema.safeParse({ password: "1234567" }).success, false);
        assert.equal(
            resetUserPasswordBodySchema.safeParse({ password: "valid-password" }).success,
            true
        );
    });
});
