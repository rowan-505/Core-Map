import assert from "node:assert/strict";
import test from "node:test";

import {
    deriveCoverageWorkStatus,
    derivePresenceStatus,
    formatActiveDuration,
    isSurveyorActiveNow,
    listSurveyRouteCoveragePath,
    listSurveyWorkHistoryPath,
    surveySessionTimelinePath,
    workStatusLabel,
} from "./fieldSurveyActivityStatus";

const now = Date.parse("2026-09-10T04:00:00.000Z");

test("stale heartbeat is not live", () => {
    assert.equal(
        isSurveyorActiveNow({
            sessionStatus: "active",
            heartbeatAtMs: Date.parse("2026-09-10T03:50:00.000Z"),
            nowMs: now,
        }),
        false
    );
    assert.equal(
        derivePresenceStatus({
            sessionStatus: "active",
            heartbeatAtMs: Date.parse("2026-09-10T03:50:00.000Z"),
            nowMs: now,
        }),
        "stale"
    );
});

test("fresh active session is live", () => {
    assert.equal(
        derivePresenceStatus({
            sessionStatus: "active",
            heartbeatAtMs: Date.parse("2026-09-10T03:59:00.000Z"),
            nowMs: now,
        }),
        "live"
    );
});

test("coverage work status and reopen partial", () => {
    assert.equal(
        deriveCoverageWorkStatus({
            hasSession: false,
            hasCompletionRow: false,
            isFinished: false,
        }),
        "not_started"
    );
    assert.equal(
        deriveCoverageWorkStatus({
            hasSession: true,
            hasCompletionRow: false,
            isFinished: false,
        }),
        "partial"
    );
    assert.equal(
        deriveCoverageWorkStatus({
            hasSession: false,
            hasCompletionRow: true,
            isFinished: false,
        }),
        "partial"
    );
    assert.equal(
        deriveCoverageWorkStatus({
            hasSession: true,
            hasCompletionRow: true,
            isFinished: true,
        }),
        "finished"
    );
    assert.equal(workStatusLabel("finished"), "Finished");
    assert.equal(formatActiveDuration(3660), "1h 1m");
});

test("coverage and history paths encode filters", () => {
    assert.equal(listSurveyRouteCoveragePath({}), "/field/survey-route-coverage");
    assert.equal(
        listSurveyRouteCoveragePath({
            surveyorPublicId: "d5389b26-e671-40f5-8aff-042a7d5303bb",
            workStatus: "finished",
            routeSearch: "YBS-13",
        }),
        "/field/survey-route-coverage?surveyorPublicId=d5389b26-e671-40f5-8aff-042a7d5303bb&workStatus=finished&routeSearch=YBS-13"
    );
    assert.equal(
        listSurveyWorkHistoryPath({ page: 1, pageSize: 50, from: "2026-08-12", to: "2026-09-10" }),
        "/field/survey-work-history?from=2026-08-12&to=2026-09-10&page=1&pageSize=50"
    );
    assert.equal(
        surveySessionTimelinePath("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        "/field/survey-sessions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/timeline"
    );
});
