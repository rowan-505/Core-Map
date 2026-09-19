import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    normalizePopularityScores,
    scoresFromActivityCounts,
} from "./place-popularity.scoring.js";
import {
    computeRawActivity30d,
    PLACE_ACTIVITY_WEIGHTS,
    PLACE_ACTIVITY_WINDOW_DAYS,
    PLACE_POPULARITY_COLD_START_TOTAL_WEIGHTED,
    PLACE_POPULARITY_NEUTRAL_SCORE,
} from "./place-popularity.weights.js";

describe("place popularity weights", () => {
    it("uses the documented V1 weights and 30-day window", () => {
        assert.equal(PLACE_ACTIVITY_WEIGHTS.view, 1);
        assert.equal(PLACE_ACTIVITY_WEIGHTS.save, 4);
        assert.equal(PLACE_ACTIVITY_WEIGHTS.share, 4);
        assert.equal(PLACE_ACTIVITY_WEIGHTS.directions, 6);
        assert.equal(PLACE_ACTIVITY_WINDOW_DAYS, 30);
        assert.equal(PLACE_POPULARITY_COLD_START_TOTAL_WEIGHTED, 20);
    });

    it("computes rawActivity30d with the documented formula", () => {
        assert.equal(
            computeRawActivity30d({ views: 3, saves: 2, shares: 1, directions: 1 }),
            3 * 1 + 2 * 4 + 1 * 4 + 1 * 6
        );
        assert.equal(computeRawActivity30d({ views: 0, saves: 0, shares: 0, directions: 0 }), 0);
    });
});

describe("normalizePopularityScores", () => {
    it("returns cold-start 50 when population total weighted points are below threshold", () => {
        const scores = normalizePopularityScores([
            { placeId: 1, rawActivity30d: 5 },
            { placeId: 2, rawActivity30d: 10 },
        ]);
        assert.equal(
            5 + 10 < PLACE_POPULARITY_COLD_START_TOTAL_WEIGHTED,
            true
        );
        assert.deepEqual(
            scores.map((s) => s.popularityScore),
            [PLACE_POPULARITY_NEUTRAL_SCORE, PLACE_POPULARITY_NEUTRAL_SCORE]
        );
        assert.ok(scores.every((s) => s.coldStart));
    });

    it("uses percent-rank within an active population", () => {
        // Total = 5+15+40 = 60 >= 20
        const scores = normalizePopularityScores([
            { placeId: "a", rawActivity30d: 5 },
            { placeId: "b", rawActivity30d: 15 },
            { placeId: "c", rawActivity30d: 40 },
        ]);
        const byId = Object.fromEntries(scores.map((s) => [s.placeId, s]));
        assert.equal(byId.a?.popularityScore, 0); // 0 below / 2
        assert.equal(byId.b?.popularityScore, 50); // 1 below / 2
        assert.equal(byId.c?.popularityScore, 100); // 2 below / 2
        assert.ok(scores.every((s) => !s.coldStart));
    });

    it("gives tied raw activity the same popularity score", () => {
        const scores = normalizePopularityScores([
            { placeId: 1, rawActivity30d: 10 },
            { placeId: 2, rawActivity30d: 30 },
            { placeId: 3, rawActivity30d: 30 },
        ]);
        // total 70
        const byId = Object.fromEntries(scores.map((s) => [String(s.placeId), s]));
        assert.equal(byId["1"]?.popularityScore, 0);
        assert.equal(byId["2"]?.popularityScore, byId["3"]?.popularityScore);
        assert.equal(byId["2"]?.popularityScore, 50); // 1 below / 2
    });

    it("keeps tourism and food populations independent when scored separately", () => {
        const tourism = scoresFromActivityCounts([
            { placeId: "t1", counts: { views: 20, saves: 0, shares: 0, directions: 0 } },
            { placeId: "t2", counts: { views: 5, saves: 0, shares: 0, directions: 0 } },
        ]);
        const food = scoresFromActivityCounts([
            { placeId: "f1", counts: { views: 100, saves: 0, shares: 0, directions: 0 } },
            { placeId: "f2", counts: { views: 1, saves: 0, shares: 0, directions: 0 } },
        ]);

        assert.equal(tourism.find((s) => s.placeId === "t1")?.popularityScore, 100);
        assert.equal(tourism.find((s) => s.placeId === "t2")?.popularityScore, 0);
        assert.equal(food.find((s) => s.placeId === "f1")?.popularityScore, 100);
        assert.equal(food.find((s) => s.placeId === "f2")?.popularityScore, 0);
        // Tourism scores are unaffected by the much larger food activity.
        assert.notEqual(
            tourism.find((s) => s.placeId === "t1")?.rawActivity30d,
            food.find((s) => s.placeId === "f1")?.rawActivity30d
        );
    });

    it("isolates township scopes when populations differ", () => {
        const townshipA = normalizePopularityScores([
            { placeId: "a1", rawActivity30d: 40 },
            { placeId: "a2", rawActivity30d: 10 },
        ]);
        const townshipB = normalizePopularityScores([
            { placeId: "b1", rawActivity30d: 40 },
            { placeId: "b2", rawActivity30d: 39 },
        ]);
        assert.equal(townshipA.find((s) => s.placeId === "a1")?.popularityScore, 100);
        assert.equal(townshipA.find((s) => s.placeId === "a2")?.popularityScore, 0);
        // Same raw 40 is only mid/high relative to its own township peers.
        assert.equal(townshipB.find((s) => s.placeId === "b1")?.popularityScore, 100);
        assert.equal(townshipB.find((s) => s.placeId === "b2")?.popularityScore, 0);
    });

    it("supports region and national tourism contexts as plain populations", () => {
        const region = normalizePopularityScores([
            { placeId: "r1", rawActivity30d: 25 },
            { placeId: "r2", rawActivity30d: 25 },
            { placeId: "r3", rawActivity30d: 50 },
        ]);
        const national = normalizePopularityScores([
            { placeId: "n1", rawActivity30d: 8 },
            { placeId: "n2", rawActivity30d: 12 },
            { placeId: "n3", rawActivity30d: 20 },
            { placeId: "n4", rawActivity30d: 40 },
        ]);
        assert.equal(region.find((s) => s.placeId === "r3")?.popularityScore, 100);
        assert.equal(national.find((s) => s.placeId === "n1")?.popularityScore, 0);
        assert.equal(national.find((s) => s.placeId === "n4")?.popularityScore, 100);
    });
});
