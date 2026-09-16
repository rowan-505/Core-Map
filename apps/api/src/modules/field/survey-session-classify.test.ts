import assert from "node:assert/strict";
import test from "node:test";

import {
    formatCoverageCheckedLabel,
    formatHistoricalCheckedLabel,
    formatReportCountLabel,
    isShortEmptySession,
} from "./survey-session-classify.js";

test("short empty requires completed under 60s with zero work and no finish", () => {
    assert.equal(
        isShortEmptySession({
            sessionStatus: "completed",
            activeDurationSeconds: 9,
            checkedStopCount: 0,
            reportCount: 0,
            finishedAt: null,
            reopenedAt: null,
        }),
        true
    );
    assert.equal(
        isShortEmptySession({
            sessionStatus: "active",
            activeDurationSeconds: 5,
            checkedStopCount: 0,
            reportCount: 0,
            finishedAt: null,
            reopenedAt: null,
        }),
        false
    );
    assert.equal(
        isShortEmptySession({
            sessionStatus: "completed",
            activeDurationSeconds: 60,
            checkedStopCount: 0,
            reportCount: 0,
            finishedAt: null,
            reopenedAt: null,
        }),
        false
    );
    assert.equal(
        isShortEmptySession({
            sessionStatus: "completed",
            activeDurationSeconds: 10,
            checkedStopCount: 0,
            reportCount: 1,
            finishedAt: null,
            reopenedAt: null,
        }),
        false
    );
    assert.equal(
        isShortEmptySession({
            sessionStatus: "completed",
            activeDurationSeconds: 10,
            checkedStopCount: 2,
            reportCount: 0,
            finishedAt: null,
            reopenedAt: null,
        }),
        false
    );
    assert.equal(
        isShortEmptySession({
            sessionStatus: "completed",
            activeDurationSeconds: 10,
            checkedStopCount: 0,
            reportCount: 0,
            finishedAt: new Date(),
            reopenedAt: null,
        }),
        false
    );
});

test("checked and report labels avoid misleading zeros", () => {
    assert.equal(formatHistoricalCheckedLabel(0, 0), "—");
    assert.equal(formatHistoricalCheckedLabel(0, null), "—");
    assert.equal(formatHistoricalCheckedLabel(3, 114), "3 / 114");
    assert.equal(formatCoverageCheckedLabel(0, 117), "0 / 117");
    assert.equal(formatCoverageCheckedLabel(0, 0), "—");
    assert.equal(formatReportCountLabel(0), "No reports");
    assert.equal(formatReportCountLabel(1), "1 report");
    assert.equal(formatReportCountLabel(4), "4 reports");
});
