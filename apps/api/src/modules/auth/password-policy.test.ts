import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    assertPasswordPolicy,
    isMfaRequiredRoleList,
    isPrivilegedRoleList,
    PasswordPolicyError,
    privilegedDashboardOAuthMfaAction,
} from "./password-policy.js";

describe("password policy", () => {
    it("rejects whitespace-only passwords", () => {
        assert.throws(() => assertPasswordPolicy("        "), PasswordPolicyError);
    });

    it("accepts a passphrase of 8+ characters", () => {
        assert.doesNotThrow(() => assertPasswordPolicy("correct horse"));
    });

    it("requires 12 characters for privileged accounts", () => {
        assert.throws(() => assertPasswordPolicy("shortpwd", { privileged: true }), PasswordPolicyError);
        assert.doesNotThrow(() => assertPasswordPolicy("twelve chars!", { privileged: true }));
    });

    it("detects privileged roles", () => {
        assert.equal(isPrivilegedRoleList(["user"]), false);
        assert.equal(isPrivilegedRoleList(["admin"]), true);
        assert.equal(isPrivilegedRoleList(["super_admin", "user"]), true);
    });

    it("requires MFA only for super_admin", () => {
        assert.equal(isMfaRequiredRoleList(["admin"]), false);
        assert.equal(isMfaRequiredRoleList(["viewer"]), false);
        assert.equal(isMfaRequiredRoleList(["super_admin"]), true);
        assert.equal(isMfaRequiredRoleList(["admin", "super_admin"]), true);
    });

    it("requires TOTP challenge for enrolled dashboard OAuth super_admins", () => {
        assert.equal(privilegedDashboardOAuthMfaAction(["viewer"], false), "session");
        assert.equal(privilegedDashboardOAuthMfaAction(["admin"], false), "session");
        assert.equal(privilegedDashboardOAuthMfaAction(["admin"], true), "mfa");
        assert.equal(privilegedDashboardOAuthMfaAction(["super_admin"], false), "enrollment_required");
        assert.equal(privilegedDashboardOAuthMfaAction(["super_admin"], true), "mfa");
    });
});
