import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeReviewScore } from "../place-reviews/place-reviews.scoring.js";
import {
    assertWeightsSumToOne,
    clampScore0to100,
    computeSeasonModifier,
    computeTourismGeoRankingBreakdown,
    isMonthInSeasonRange,
    normalizeImportanceScore,
    previewTourismGeoRankingScore,
    resolveManualBoost,
    roundTourismScoreForDisplay,
    sortTourismGeoRankingRows,
    toTourismGeoRankingBreakdownDto,
    TOURISM_GEO_RANKING_ALGORITHM_VERSION,
    TOURISM_GEO_RANKING_V1_WEIGHTS,
    type TourismGeoRankingInputs,
} from "./tourism.geo-ranking.js";

const BASE_INPUTS: TourismGeoRankingInputs = {
    editorialScore: 50,
    importanceScore: 50,
    averageRating: null,
    publishedReviewCount: 0,
    popularityScore: 50,
    seasonMode: "all_year",
    seasonStartMonth: null,
    seasonEndMonth: null,
    manualBoost: 0,
    referenceMonth: 6,
};

describe("tourism geo ranking V1 weights", () => {
    it("keeps township/region/national weights summing to 1", () => {
        for (const scope of ["township", "region", "national"] as const) {
            assert.equal(assertWeightsSumToOne(TOURISM_GEO_RANKING_V1_WEIGHTS[scope]), true);
        }
        assert.deepEqual(TOURISM_GEO_RANKING_V1_WEIGHTS.township, {
            editorialWeight: 0.5,
            importanceWeight: 0.25,
            reviewWeight: 0.15,
            popularityWeight: 0.1,
        });
        assert.deepEqual(TOURISM_GEO_RANKING_V1_WEIGHTS.region, {
            editorialWeight: 0.4,
            importanceWeight: 0.3,
            reviewWeight: 0.15,
            popularityWeight: 0.15,
        });
        assert.deepEqual(TOURISM_GEO_RANKING_V1_WEIGHTS.national, {
            editorialWeight: 0.3,
            importanceWeight: 0.4,
            reviewWeight: 0.15,
            popularityWeight: 0.15,
        });
    });

    it("uses algorithm_version coremap-tourism-ranking-v1", () => {
        assert.equal(TOURISM_GEO_RANKING_ALGORITHM_VERSION, "coremap-tourism-ranking-v1");
        const row = previewTourismGeoRankingScore(BASE_INPUTS, "national");
        assert.equal(row.algorithmVersion, "coremap-tourism-ranking-v1");
        assert.equal(row.scope, "national");
    });
});

describe("season month ranges", () => {
    it("handles cross-year Nov–Feb", () => {
        assert.equal(isMonthInSeasonRange(11, 11, 2), true);
        assert.equal(isMonthInSeasonRange(12, 11, 2), true);
        assert.equal(isMonthInSeasonRange(1, 11, 2), true);
        assert.equal(isMonthInSeasonRange(2, 11, 2), true);
        assert.equal(isMonthInSeasonRange(3, 11, 2), false);
        assert.equal(isMonthInSeasonRange(10, 11, 2), false);
    });

    it("applies documented season modifiers", () => {
        assert.equal(
            computeSeasonModifier({
                seasonMode: "all_year",
                seasonStartMonth: null,
                seasonEndMonth: null,
                referenceMonth: 6,
            }),
            1.0
        );
        assert.equal(
            computeSeasonModifier({
                seasonMode: "best_months",
                seasonStartMonth: 11,
                seasonEndMonth: 2,
                referenceMonth: 12,
            }),
            1.05
        );
        assert.equal(
            computeSeasonModifier({
                seasonMode: "best_months",
                seasonStartMonth: 11,
                seasonEndMonth: 2,
                referenceMonth: 6,
            }),
            1.0
        );
        assert.equal(
            computeSeasonModifier({
                seasonMode: "poor_months",
                seasonStartMonth: 6,
                seasonEndMonth: 9,
                referenceMonth: 7,
            }),
            0.9
        );
        assert.equal(
            computeSeasonModifier({
                seasonMode: "poor_months",
                seasonStartMonth: 6,
                seasonEndMonth: 9,
                referenceMonth: 1,
            }),
            1.0
        );
        assert.equal(
            computeSeasonModifier({
                seasonMode: "temporarily_closed",
                seasonStartMonth: null,
                seasonEndMonth: null,
                referenceMonth: 1,
            }),
            null
        );
    });
});

describe("reviewScore via universal service", () => {
    it("covers zero / one / five / twenty 5-star and one 1-star cases", () => {
        assert.equal(computeReviewScore(null, 0), 50);
        assert.equal(computeReviewScore(5, 0), 50);
        // one 5-star: 50 + (100-50)*(1/20) = 52.5
        assert.equal(computeReviewScore(5, 1), 52.5);
        // five 5-star: 50 + 50*(5/20) = 62.5
        assert.equal(computeReviewScore(5, 5), 62.5);
        // twenty 5-star: full confidence → 100
        assert.equal(computeReviewScore(5, 20), 100);
        // one 1-star: 50 + (20-50)*(1/20) = 48.5
        assert.equal(computeReviewScore(1, 1), 48.5);
    });
});

describe("computeTourismGeoRankingBreakdown", () => {
    it("uses fallbacks for missing editorial/review/popularity", () => {
        const row = computeTourismGeoRankingBreakdown(
            {
                editorialScore: null,
                importanceScore: 80,
                averageRating: null,
                publishedReviewCount: 0,
                popularityScore: null,
                seasonMode: "all_year",
                seasonStartMonth: null,
                seasonEndMonth: null,
                manualBoost: 0,
                referenceMonth: 1,
            },
            TOURISM_GEO_RANKING_V1_WEIGHTS.township,
            "township"
        );
        assert.equal(row.editorialScore, 50);
        assert.equal(row.reviewScore, 50);
        assert.equal(row.popularityScore, 50);
        assert.equal(row.importanceScore, 80);
        assert.equal(row.excluded, false);
        // 50*0.5 + 80*0.25 + 50*0.15 + 50*0.10 = 57.5
        assert.equal(row.baseScore, 57.5);
        assert.equal(row.seasonAdjustedScore, 57.5);
        assert.equal(row.finalScore, 57.5);
        assert.equal(row.editorialContribution, 25);
        assert.equal(row.importanceContribution, 20);
    });

    it("applies season modifier and manual boost then clamps", () => {
        const row = computeTourismGeoRankingBreakdown(
            {
                editorialScore: 80,
                importanceScore: 80,
                averageRating: 5,
                publishedReviewCount: 20,
                popularityScore: 80,
                seasonMode: "best_months",
                seasonStartMonth: 1,
                seasonEndMonth: 3,
                manualBoost: 5,
                referenceMonth: 2,
            },
            TOURISM_GEO_RANKING_V1_WEIGHTS.national,
            "national"
        );
        assert.equal(row.baseScore, 83);
        assert.equal(row.seasonModifier, 1.05);
        assert.equal(row.seasonAdjustedScore, 87.15);
        assert.equal(row.finalScore, 92.15);
    });

    it("clamps finalScore to 0..100 at boost boundaries", () => {
        const high = computeTourismGeoRankingBreakdown(
            {
                ...BASE_INPUTS,
                editorialScore: 100,
                importanceScore: 100,
                averageRating: 5,
                publishedReviewCount: 20,
                popularityScore: 100,
                manualBoost: 10,
            },
            TOURISM_GEO_RANKING_V1_WEIGHTS.national,
            "national"
        );
        assert.equal(high.finalScore, 100);
        assert.equal(resolveManualBoost(10), 10);
        assert.equal(resolveManualBoost(-10), -10);
        assert.equal(resolveManualBoost(11), 10);
        assert.equal(resolveManualBoost(-11), -10);

        const low = computeTourismGeoRankingBreakdown(
            {
                ...BASE_INPUTS,
                editorialScore: 0,
                importanceScore: 0,
                popularityScore: 0,
                manualBoost: -10,
            },
            TOURISM_GEO_RANKING_V1_WEIGHTS.township,
            "township"
        );
        assert.equal(low.baseScore, 7.5); // review cold-start 50 * 0.15
        assert.equal(low.finalScore, 0);
        assert.equal(clampScore0to100(-1), 0);
        assert.equal(clampScore0to100(101), 100);
    });

    it("excludes temporarily_closed places", () => {
        const row = computeTourismGeoRankingBreakdown(
            {
                editorialScore: 95,
                importanceScore: 100,
                averageRating: 5,
                publishedReviewCount: 50,
                popularityScore: 100,
                seasonMode: "temporarily_closed",
                seasonStartMonth: null,
                seasonEndMonth: null,
                manualBoost: 10,
                referenceMonth: 1,
            },
            TOURISM_GEO_RANKING_V1_WEIGHTS.region,
            "region"
        );
        assert.equal(row.excluded, true);
        assert.equal(row.finalScore, 0);
    });

    it("applies best/poor/all-year and cross-year season on finalScore", () => {
        const shared = {
            editorialScore: 80,
            importanceScore: 40,
            averageRating: null,
            publishedReviewCount: 0,
            popularityScore: 20,
            seasonStartMonth: 11,
            seasonEndMonth: 2,
            manualBoost: 0,
        } as const;

        const allYear = computeTourismGeoRankingBreakdown(
            { ...shared, seasonMode: "all_year", referenceMonth: 12 },
            TOURISM_GEO_RANKING_V1_WEIGHTS.township,
            "township"
        );
        const bestIn = computeTourismGeoRankingBreakdown(
            { ...shared, seasonMode: "best_months", referenceMonth: 12 },
            TOURISM_GEO_RANKING_V1_WEIGHTS.township,
            "township"
        );
        const bestOut = computeTourismGeoRankingBreakdown(
            { ...shared, seasonMode: "best_months", referenceMonth: 6 },
            TOURISM_GEO_RANKING_V1_WEIGHTS.township,
            "township"
        );
        const poorIn = computeTourismGeoRankingBreakdown(
            { ...shared, seasonMode: "poor_months", referenceMonth: 1 },
            TOURISM_GEO_RANKING_V1_WEIGHTS.township,
            "township"
        );

        assert.equal(allYear.seasonModifier, 1);
        assert.equal(bestIn.seasonModifier, 1.05);
        assert.equal(bestOut.seasonModifier, 1);
        assert.equal(poorIn.seasonModifier, 0.9);
        assert.ok(bestIn.finalScore > allYear.finalScore);
        assert.ok(poorIn.finalScore < allYear.finalScore);
        assert.equal(bestOut.finalScore, allYear.finalScore);
    });

    it("normalizes importance without mutating semantics beyond 0..100 clamp", () => {
        assert.equal(normalizeImportanceScore(120), 100);
        assert.equal(normalizeImportanceScore(-5), 0);
        assert.equal(normalizeImportanceScore(null), 0);
    });

    it("keeps township, region, and national independent for the same inputs", () => {
        const inputs: TourismGeoRankingInputs = {
            editorialScore: 80,
            importanceScore: 40,
            averageRating: 4,
            publishedReviewCount: 10,
            popularityScore: 20,
            seasonMode: "all_year",
            seasonStartMonth: null,
            seasonEndMonth: null,
            manualBoost: 0,
            referenceMonth: 5,
        };
        const township = computeTourismGeoRankingBreakdown(
            inputs,
            TOURISM_GEO_RANKING_V1_WEIGHTS.township,
            "township"
        );
        const region = computeTourismGeoRankingBreakdown(
            inputs,
            TOURISM_GEO_RANKING_V1_WEIGHTS.region,
            "region"
        );
        const national = computeTourismGeoRankingBreakdown(
            inputs,
            TOURISM_GEO_RANKING_V1_WEIGHTS.national,
            "national"
        );
        assert.notEqual(township.finalScore, national.finalScore);
        assert.notEqual(township.finalScore, region.finalScore);
        assert.ok(township.finalScore > national.finalScore);
        assert.equal(township.editorialWeight, 0.5);
        assert.equal(region.editorialWeight, 0.4);
        assert.equal(national.importanceWeight, 0.4);
    });

    it("is deterministic for identical inputs", () => {
        const a = previewTourismGeoRankingScore(BASE_INPUTS, "region");
        const b = previewTourismGeoRankingScore(BASE_INPUTS, "region");
        assert.deepEqual(a, b);
    });

    it("matches preview and breakdown math for public/admin shared path", () => {
        const inputs: TourismGeoRankingInputs = {
            editorialScore: 65,
            importanceScore: 70,
            averageRating: 5,
            publishedReviewCount: 5,
            popularityScore: 40,
            seasonMode: "all_year",
            seasonStartMonth: null,
            seasonEndMonth: null,
            manualBoost: 0,
            referenceMonth: 3,
        };
        const preview = previewTourismGeoRankingScore(inputs, "township");
        const breakdown = computeTourismGeoRankingBreakdown(
            inputs,
            TOURISM_GEO_RANKING_V1_WEIGHTS.township,
            "township"
        );
        assert.deepEqual(preview, breakdown);
        assert.equal(preview.reviewScore, 62.5);
    });

    it("rounds display DTO without changing ranking precision", () => {
        const row = computeTourismGeoRankingBreakdown(
            {
                editorialScore: 80,
                importanceScore: 80,
                averageRating: 5,
                publishedReviewCount: 20,
                popularityScore: 80,
                seasonMode: "best_months",
                seasonStartMonth: 1,
                seasonEndMonth: 3,
                manualBoost: 5,
                referenceMonth: 2,
            },
            TOURISM_GEO_RANKING_V1_WEIGHTS.national,
            "national"
        );
        assert.equal(row.finalScore, 92.15);
        const dto = toTourismGeoRankingBreakdownDto(row, 3);
        assert.equal(dto.final_score, 92.15);
        assert.equal(dto.rank, 3);
        assert.equal(dto.algorithm_version, "coremap-tourism-ranking-v1");
        assert.equal(dto.scope, "national");
        assert.equal(roundTourismScoreForDisplay(92.155), 92.16);
        assert.equal(roundTourismScoreForDisplay(92.154), 92.15);
    });
});

describe("sortTourismGeoRankingRows", () => {
    it("sorts by final, importance, editorial, then stable place id", () => {
        const sorted = sortTourismGeoRankingRows([
            { placeId: 3, finalScore: 70, importanceScore: 50, editorialScore: 50 },
            { placeId: 1, finalScore: 90, importanceScore: 10, editorialScore: 10 },
            { placeId: 2, finalScore: 70, importanceScore: 80, editorialScore: 20 },
            { placeId: 4, finalScore: 70, importanceScore: 80, editorialScore: 40 },
            { placeId: 5, finalScore: 70, importanceScore: 80, editorialScore: 40 },
        ]);
        assert.deepEqual(
            sorted.map((r) => r.placeId),
            [1, 4, 5, 2, 3]
        );
    });

    it("keeps deterministic ties on public id string compare", () => {
        const sorted = sortTourismGeoRankingRows([
            {
                placeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                finalScore: 50,
                importanceScore: 50,
                editorialScore: 50,
            },
            {
                placeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                finalScore: 50,
                importanceScore: 50,
                editorialScore: 50,
            },
        ]);
        assert.equal(sorted[0]?.placeId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    });
});
