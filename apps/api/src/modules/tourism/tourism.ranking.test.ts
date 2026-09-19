import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    compareTourismRankSortKeys,
    computeTourismBayesianScore,
    TOURISM_BAYESIAN_PRIOR_WEIGHT,
    TOURISM_TOP_RATED_MIN_REVIEWS,
} from "./tourism.ranking.js";

describe("computeTourismBayesianScore", () => {
    it("returns null when there are zero published reviews globally", () => {
        assert.equal(
            computeTourismBayesianScore({
                placeAverageRating: 5,
                publishedReviewCount: 1,
                globalAverageRating: null,
                globalPublishedReviewCount: 0,
            }),
            null
        );
    });

    it("scores one five-star review toward the prior", () => {
        const C = 4;
        const score = computeTourismBayesianScore({
            placeAverageRating: 5,
            publishedReviewCount: 1,
            globalAverageRating: C,
            globalPublishedReviewCount: 10,
        });
        const m = TOURISM_BAYESIAN_PRIOR_WEIGHT;
        const expected = (1 / (1 + m)) * 5 + (m / (1 + m)) * C;
        assert.equal(score, expected);
        assert.ok(score !== null && score < 5 && score > C);
    });

    it("scores one low rating toward the prior", () => {
        const C = 4;
        const score = computeTourismBayesianScore({
            placeAverageRating: 1,
            publishedReviewCount: 1,
            globalAverageRating: C,
            globalPublishedReviewCount: 10,
        });
        const m = TOURISM_BAYESIAN_PRIOR_WEIGHT;
        const expected = (1 / (1 + m)) * 1 + (m / (1 + m)) * C;
        assert.equal(score, expected);
        assert.ok(score !== null && score > 1 && score < C);
    });

    it("weights five reviews more toward the place average", () => {
        const C = 3;
        const R = 5;
        const v = 5;
        const score = computeTourismBayesianScore({
            placeAverageRating: R,
            publishedReviewCount: v,
            globalAverageRating: C,
            globalPublishedReviewCount: 100,
        });
        const m = TOURISM_BAYESIAN_PRIOR_WEIGHT;
        const expected = (v / (v + m)) * R + (m / (v + m)) * C;
        assert.equal(score, expected);
        assert.equal(v, TOURISM_TOP_RATED_MIN_REVIEWS);
        assert.ok(score !== null && score >= 4);
    });

    it("moves when the global average changes", () => {
        const base = {
            placeAverageRating: 5,
            publishedReviewCount: 2,
            globalPublishedReviewCount: 50,
        };
        const lowC = computeTourismBayesianScore({ ...base, globalAverageRating: 2 });
        const highC = computeTourismBayesianScore({ ...base, globalAverageRating: 4.5 });
        assert.ok(lowC !== null && highC !== null);
        assert.ok(highC > lowC);
    });

    it("returns null for a place with zero published reviews", () => {
        assert.equal(
            computeTourismBayesianScore({
                placeAverageRating: null,
                publishedReviewCount: 0,
                globalAverageRating: 4,
                globalPublishedReviewCount: 20,
            }),
            null
        );
    });
});

describe("compareTourismRankSortKeys", () => {
    it("breaks equal bayesian scores by review count then verified then id", () => {
        const a = {
            bayesianScore: 4.2,
            publishedReviewCount: 5,
            isVerified: false,
            distanceMeters: null,
            publicId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        };
        const b = {
            bayesianScore: 4.2,
            publishedReviewCount: 5,
            isVerified: true,
            distanceMeters: null,
            publicId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        };
        assert.ok(compareTourismRankSortKeys("recommended", b, a) < 0);

        const c = { ...a, publishedReviewCount: 10 };
        assert.ok(compareTourismRankSortKeys("recommended", c, a) < 0);
    });

    it("orders nearby by distance only", () => {
        const near = {
            bayesianScore: 1,
            publishedReviewCount: 100,
            isVerified: false,
            distanceMeters: 50,
            publicId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        };
        const far = {
            bayesianScore: 5,
            publishedReviewCount: 1,
            isVerified: true,
            distanceMeters: 500,
            publicId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        };
        assert.ok(compareTourismRankSortKeys("nearby", near, far) < 0);
    });

    it("orders most_reviewed by count then verified", () => {
        const many = {
            bayesianScore: null,
            publishedReviewCount: 20,
            isVerified: false,
            distanceMeters: null,
            publicId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        };
        const few = {
            bayesianScore: 5,
            publishedReviewCount: 2,
            isVerified: true,
            distanceMeters: null,
            publicId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        };
        assert.ok(compareTourismRankSortKeys("most_reviewed", many, few) < 0);
    });
});
