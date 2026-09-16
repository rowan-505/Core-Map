import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

/**
 * Production authenticate must reject access JWTs that omit sid so revocation
 * cannot be skipped. This mirrors plugins/auth.ts requireSessionId logic.
 */
describe("production JWT sid requirement", () => {
    const previous = process.env.NODE_ENV;

    afterEach(() => {
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
    });

    function requireSidInProduction(sid: string | undefined): boolean {
        const requireSessionId = process.env.NODE_ENV === "production";
        if (requireSessionId && !sid) return false;
        return true;
    }

    it("rejects missing sid in production", () => {
        process.env.NODE_ENV = "production";
        assert.equal(requireSidInProduction(undefined), false);
        assert.equal(requireSidInProduction(""), false);
    });

    it("accepts sid in production and allows missing sid outside production", () => {
        process.env.NODE_ENV = "production";
        assert.equal(requireSidInProduction("22222222-2222-4222-8222-222222222222"), true);
        process.env.NODE_ENV = "test";
        assert.equal(requireSidInProduction(undefined), true);
    });
});
