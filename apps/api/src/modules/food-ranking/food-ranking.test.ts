import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    assertFoodWeightsSumToOne,
    computeFoodDrinkRankingBreakdown,
    computeFoodDrinkScore,
    FOOD_DRINK_TOWNSHIP_V1_WEIGHTS,
    haversineDistanceMeters,
    normalizeImportanceScore,
    sortFoodDrinkRankingRows,
} from "./food-ranking.js";

describe("food drink township V1 weights", () => {
    it("sums to 1 and matches documented formula", () => {
        assert.equal(assertFoodWeightsSumToOne(FOOD_DRINK_TOWNSHIP_V1_WEIGHTS), true);
        assert.deepEqual(FOOD_DRINK_TOWNSHIP_V1_WEIGHTS, {
            reviewWeight: 0.5,
            popularityWeight: 0.3,
            importanceWeight: 0.2,
        });
    });
});

describe("computeFoodDrinkRankingBreakdown", () => {
    it("uses confidence-adjusted reviewScore and ignores tourism inputs", () => {
        const few = computeFoodDrinkRankingBreakdown({
            averageRating: 5,
            publishedReviewCount: 1,
            popularityScore: 50,
            importanceScore: 50,
        });
        // reviewScore(5,1) = 52.5
        assert.equal(few.reviewScore, 52.5);
        // 52.5*0.5 + 50*0.3 + 50*0.2 = 26.25 + 15 + 10 = 51.25
        assert.equal(few.foodScore, 51.25);

        const many = computeFoodDrinkRankingBreakdown({
            averageRating: 5,
            publishedReviewCount: 20,
            popularityScore: 50,
            importanceScore: 50,
        });
        assert.equal(many.reviewScore, 100);
        assert.equal(many.foodScore, 75);
        assert.ok(many.foodScore > few.foodScore);
    });

    it("falls back to neutral review/popularity when missing", () => {
        const row = computeFoodDrinkRankingBreakdown({
            averageRating: null,
            publishedReviewCount: 0,
            popularityScore: null,
            importanceScore: 80,
        });
        assert.equal(row.reviewScore, 50);
        assert.equal(row.popularityScore, 50);
        assert.equal(row.importanceScore, 80);
        // 50*0.5 + 50*0.3 + 80*0.2 = 25 + 15 + 16 = 56
        assert.equal(row.foodScore, 56);
    });

    it("does not apply tourism editorial/season/boost semantics", () => {
        const score = computeFoodDrinkScore({
            reviewScore: 60,
            popularityScore: 40,
            importanceScore: 20,
        });
        // Pure weighted sum only — no season multiplier or boost.
        assert.equal(score, 60 * 0.5 + 40 * 0.3 + 20 * 0.2);
    });

    it("clamps importance to 0..100", () => {
        assert.equal(normalizeImportanceScore(120), 100);
        assert.equal(normalizeImportanceScore(-5), 0);
        assert.equal(normalizeImportanceScore(null), 0);
    });
});

describe("sortFoodDrinkRankingRows", () => {
    it("sorts by foodScore, importance, reviewScore, then place id", () => {
        const sorted = sortFoodDrinkRankingRows([
            { placeId: 3, foodScore: 70, importanceScore: 50, reviewScore: 50 },
            { placeId: 1, foodScore: 90, importanceScore: 10, reviewScore: 10 },
            { placeId: 2, foodScore: 70, importanceScore: 80, reviewScore: 20 },
            { placeId: 4, foodScore: 70, importanceScore: 80, reviewScore: 40 },
            { placeId: 5, foodScore: 70, importanceScore: 80, reviewScore: 40 },
        ]);
        assert.deepEqual(
            sorted.map((r) => r.placeId),
            [1, 4, 5, 2, 3]
        );
    });
});

describe("haversineDistanceMeters", () => {
    it("returns ~0 for identical points and positive distance otherwise", () => {
        assert.ok(haversineDistanceMeters(16.8, 96.1, 16.8, 96.1) < 1);
        assert.ok(haversineDistanceMeters(16.8, 96.1, 16.9, 96.2) > 1000);
    });
});
