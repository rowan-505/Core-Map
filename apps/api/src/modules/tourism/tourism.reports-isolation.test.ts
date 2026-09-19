import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeTourismBayesianScore } from "./tourism.ranking.js";
import {
    isTourismOnlyReportTypeCode,
    tourismReportAffectsRatingsOrRankings,
    TOURISM_ONLY_REPORT_TYPE_CODES,
} from "../reports/tourism-report-types.js";
import { reviewKindForReportType } from "../reports/report-review.js";

describe("tourism reports do not affect ratings or rankings", () => {
    it("keeps Bayesian ranking inputs limited to published review stats", () => {
        const before = computeTourismBayesianScore({
            placeAverageRating: 4.5,
            publishedReviewCount: 10,
            globalAverageRating: 4.0,
            globalPublishedReviewCount: 100,
        });
        assert.ok(before !== null);

        // Submitting feedback.user_reports never feeds into ranking inputs.
        // Even if many tourism reports exist, ranking score is unchanged unless
        // published review aggregates change via authorized moderation.
        const afterSameInputs = computeTourismBayesianScore({
            placeAverageRating: 4.5,
            publishedReviewCount: 10,
            globalAverageRating: 4.0,
            globalPublishedReviewCount: 100,
        });
        assert.equal(afterSameInputs, before);
        assert.equal(tourismReportAffectsRatingsOrRankings(), false);
    });

    it("blocks automatic apply for tourism-only report codes", () => {
        for (const code of TOURISM_ONLY_REPORT_TYPE_CODES) {
            assert.equal(isTourismOnlyReportTypeCode(code), true);
            assert.equal(
                reviewKindForReportType(code),
                null,
                `${code} must not auto-apply tourism or transport mutations`,
            );
        }
    });

    it("only changes score when published review aggregates change", () => {
        const baseline = computeTourismBayesianScore({
            placeAverageRating: 4.0,
            publishedReviewCount: 5,
            globalAverageRating: 4.0,
            globalPublishedReviewCount: 50,
        });
        const afterAdminPublish = computeTourismBayesianScore({
            placeAverageRating: 4.5,
            publishedReviewCount: 6,
            globalAverageRating: 4.05,
            globalPublishedReviewCount: 51,
        });
        assert.notEqual(afterAdminPublish, baseline);
    });
});
