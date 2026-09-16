import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateRefreshToken, hashRefreshToken, idleExpiry, absoluteExpiry } from "./refresh-token.js";

describe("refresh token helpers", () => {
    it("hashes deterministically", () => {
        const token = generateRefreshToken();
        assert.equal(hashRefreshToken(token), hashRefreshToken(token));
        assert.notEqual(hashRefreshToken(token), token);
    });

    it("keeps idle shorter than absolute", () => {
        const now = new Date("2026-01-01T00:00:00.000Z");
        assert.equal(idleExpiry(now).getTime() < absoluteExpiry(now).getTime(), true);
    });
});
