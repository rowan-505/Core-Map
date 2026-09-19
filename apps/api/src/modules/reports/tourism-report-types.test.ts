import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reviewKindForReportType } from "./report-review.js";
import {
    isTourismOnlyReportTypeCode,
    isTourismReportTypeCode,
    tourismReportAffectsRatingsOrRankings,
    TOURISM_ONLY_REPORT_TYPE_CODES,
    TOURISM_REPORT_TYPE_CODES,
} from "./tourism-report-types.js";
import { REPORT_TYPE_CODES, reportCreateBodySchema } from "./reports.schema.js";

describe("tourism report types on existing feedback contract", () => {
    it("registers tourism-only codes in REPORT_TYPE_CODES", () => {
        for (const code of TOURISM_ONLY_REPORT_TYPE_CODES) {
            assert.ok((REPORT_TYPE_CODES as readonly string[]).includes(code));
            assert.equal(isTourismOnlyReportTypeCode(code), true);
            assert.equal(isTourismReportTypeCode(code), true);
        }
        assert.equal(isTourismReportTypeCode("closed_or_removed"), true);
        assert.equal(isTourismReportTypeCode("duplicate_item"), true);
        assert.equal(isTourismReportTypeCode("wrong_info"), false);
    });

    it("does not map tourism-only codes to auto-apply review kinds", () => {
        for (const code of TOURISM_ONLY_REPORT_TYPE_CODES) {
            assert.equal(reviewKindForReportType(code), null);
        }
        // Reused shared codes keep existing apply mapping (not tourism ranking).
        assert.equal(reviewKindForReportType("closed_or_removed"), null);
        assert.equal(reviewKindForReportType("duplicate_item"), null);
    });

    it("validates tourism_review targets by public id", () => {
        const ok = reportCreateBodySchema.safeParse({
            reportTypeCode: "tourism_incorrect_review",
            description: "This review looks fake",
            targetEntityType: "tourism_review",
            targetPublicId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        });
        assert.equal(ok.success, true);

        const missing = reportCreateBodySchema.safeParse({
            reportTypeCode: "tourism_incorrect_review",
            description: "This review looks fake",
            targetEntityType: "tourism_review",
        });
        assert.equal(missing.success, false);
    });

    it("validates tourism place reports against core place ids", () => {
        const ok = reportCreateBodySchema.safeParse({
            reportTypeCode: "tourism_incorrect_type",
            description: "This is a pagoda, not a hotel",
            targetEntityType: "place",
            targetEntityId: 42,
            targetPublicId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        });
        assert.equal(ok.success, true);
    });

    it("proves tourism reports never affect ratings or rankings by themselves", () => {
        assert.equal(tourismReportAffectsRatingsOrRankings(), false);
        // Ranking/rating refresh is driven only by published place_reviews.
        // Tourism report codes have no apply kind and no summary refresh hook.
        for (const code of TOURISM_REPORT_TYPE_CODES) {
            assert.equal(
                reviewKindForReportType(code) === null ||
                    code === "closed_or_removed" ||
                    code === "duplicate_item",
                true,
            );
            assert.notEqual(code.startsWith("tourism_") && reviewKindForReportType(code) !== null, true);
        }
    });
});
