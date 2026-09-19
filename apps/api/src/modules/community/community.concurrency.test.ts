import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextVerificationStatus, scoreForReaction } from "./community.trust.js";

/**
 * Documents intended concurrent reaction safety:
 * repo upserts under FOR UPDATE + unique(post_id,user_id), then recalculates
 * trust from all rows in the same transaction. This unit models replacement
 * semantics without a live DB.
 */
describe("community concurrent reaction safety (model)", () => {
    it("replacing a reaction changes weight by delta, not by stacking", () => {
        const before = new Map<string, "confirm" | "helpful" | "incorrect">([
            ["u1", "confirm"],
            ["u2", "confirm"],
            ["u3", "confirm"],
            ["u4", "confirm"],
        ]);
        let score = 0;
        for (const type of before.values()) score += scoreForReaction(type);
        assert.equal(score, 8);
        assert.equal(
            nextVerificationStatus({ current: "unverified", trustScore: score }).next,
            "community_confirmed"
        );

        // Concurrent writers must upsert the same user row, not insert twice.
        before.set("u4", "incorrect");
        score = 0;
        for (const type of before.values()) score += scoreForReaction(type);
        assert.equal(score, 3);
        assert.equal(
            nextVerificationStatus({ current: "community_confirmed", trustScore: score }).next,
            "unverified"
        );
    });
});
