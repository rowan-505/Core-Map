import assert from "node:assert/strict";
import test from "node:test";

import {
    deriveCompletionStatus,
    deriveCoverageWorkStatus,
    derivePresenceStatus,
    deriveSessionStatus,
    isCoverageRemaining,
    summarizeRouteCoverage,
} from "./survey-coverage-status.js";
import {
    resolveCoverageSurveyor,
    SurveyCoverageSurveyorError,
    type SurveyCoverageSurveyorRepository,
} from "./survey-coverage-surveyor.js";
import type { SurveyRouteCoverageRepository } from "./survey-route-coverage.repo.js";
import { SurveyRouteCoverageService } from "./survey-route-coverage.service.js";
import type { SurveyWorkHistoryRepository } from "./survey-work-history.repo.js";
import { SurveyWorkHistoryService } from "./survey-work-history.service.js";

const now = new Date("2026-09-11T04:00:00.000Z");
const fresh = new Date("2026-09-11T03:59:00.000Z");
const stale = new Date("2026-09-11T03:50:00.000Z");

const surveyorA = {
    userId: 1n,
    publicId: "d5389b26-e671-40f5-8aff-042a7d5303bb",
    displayName: "Field Surveyor",
    email: "surveyor@coremapmm.com",
};

const surveyorB = {
    userId: 2n,
    publicId: "38249b57-a3cb-4afb-aea7-e97c4b1f6b64",
    displayName: "Other",
    email: "other@example.com",
};

test("new active variant with no session or completion is Not started", () => {
    assert.equal(
        deriveCoverageWorkStatus({
            hasSession: false,
            hasCompletionRow: false,
            isFinished: false,
        }),
        "not_started"
    );
});

test("D0 finished does not imply D1 finished", () => {
    const d0 = deriveCoverageWorkStatus({
        hasSession: true,
        hasCompletionRow: true,
        isFinished: true,
    });
    const d1 = deriveCoverageWorkStatus({
        hasSession: false,
        hasCompletionRow: false,
        isFinished: false,
    });
    assert.equal(d0, "finished");
    assert.equal(d1, "not_started");
    assert.equal(isCoverageRemaining(d0), false);
    assert.equal(isCoverageRemaining(d1), true);
});

test("session without finish is Partial; finished completion is Finished", () => {
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
            hasSession: true,
            hasCompletionRow: true,
            isFinished: true,
        }),
        "finished"
    );
});

test("reopened completion row (not finished) is Partial", () => {
    assert.equal(
        deriveCoverageWorkStatus({
            hasSession: false,
            hasCompletionRow: true,
            isFinished: false,
        }),
        "partial"
    );
    assert.equal(
        deriveCompletionStatus({ hasCompletionRow: true, isFinished: false }),
        "not_finished"
    );
});

test("stale heartbeat is not live", () => {
    assert.equal(
        derivePresenceStatus({
            sessionStatus: "active",
            heartbeatAtMs: stale.getTime(),
            nowMs: now.getTime(),
        }),
        "stale"
    );
    assert.equal(
        derivePresenceStatus({
            sessionStatus: "active",
            heartbeatAtMs: fresh.getTime(),
            nowMs: now.getTime(),
        }),
        "live"
    );
    assert.equal(
        derivePresenceStatus({
            sessionStatus: "completed",
            heartbeatAtMs: fresh.getTime(),
            nowMs: now.getTime(),
        }),
        "offline"
    );
});

test("session status mapping", () => {
    assert.equal(deriveSessionStatus("active"), "active");
    assert.equal(deriveSessionStatus(null), "none");
    assert.equal(deriveSessionStatus("weird"), "none");
});

test("resolveCoverageSurveyor auto-selects unique surveyor", async () => {
    const repo = {
        findActiveSurveyorByPublicId: async () => null,
        listActiveSurveyors: async () => [surveyorA],
    } as unknown as SurveyCoverageSurveyorRepository;
    const resolved = await resolveCoverageSurveyor(repo);
    assert.equal(resolved.publicId, surveyorA.publicId);
});

test("resolveCoverageSurveyor requires selection when multiple surveyors", async () => {
    const repo = {
        findActiveSurveyorByPublicId: async () => null,
        listActiveSurveyors: async () => [surveyorA, surveyorB],
    } as unknown as SurveyCoverageSurveyorRepository;
    await assert.rejects(
        () => resolveCoverageSurveyor(repo),
        (error: unknown) =>
            error instanceof SurveyCoverageSurveyorError &&
            error.code === "SURVEYOR_SELECTION_REQUIRED"
    );
});

test("resolveCoverageSurveyor uses explicit public id", async () => {
    const repo = {
        findActiveSurveyorByPublicId: async (id: string) =>
            id === surveyorB.publicId ? surveyorB : null,
        listActiveSurveyors: async () => [surveyorA, surveyorB],
    } as unknown as SurveyCoverageSurveyorRepository;
    const resolved = await resolveCoverageSurveyor(repo, surveyorB.publicId);
    assert.equal(resolved.publicId, surveyorB.publicId);
});

test("route coverage service maps statuses and summary without assignments", async () => {
    const coverageRepo = {
        listActiveVariantCoverage: async () => [
            {
                route_public_id: "22222222-2222-4222-8222-222222222222",
                route_code: "YBS-13",
                route_variant_public_id: "33333333-3333-4333-8333-333333333333",
                direction_id: 0,
                has_session: false,
                has_completion_row: false,
                is_finished: false,
                session_public_id: null,
                session_status: null,
                session_started_at: null,
                last_activity_at: null,
                last_gps_at: null,
                accumulated_active_seconds: null,
                last_checked_stop_sequence: null,
                checked_stop_count: null,
                session_total_stop_count: null,
                canonical_total_stop_count: 0,
                latest_session_report_count: 0,
                variant_report_count: 0,
                pending_sync_count: null,
                client_sync_state: null,
            },
            {
                route_public_id: "22222222-2222-4222-8222-222222222222",
                route_code: "YBS-13",
                route_variant_public_id: "55555555-5555-4555-8555-555555555555",
                direction_id: 1,
                has_session: true,
                has_completion_row: true,
                is_finished: true,
                session_public_id: "44444444-4444-4444-8444-444444444444",
                session_status: "completed",
                session_started_at: fresh,
                last_activity_at: stale,
                last_gps_at: stale,
                accumulated_active_seconds: 120,
                last_checked_stop_sequence: 10,
                checked_stop_count: 10,
                session_total_stop_count: 20,
                canonical_total_stop_count: 20,
                latest_session_report_count: 2,
                variant_report_count: 3,
                pending_sync_count: 0,
                client_sync_state: "SYNCED",
            },
        ],
    } as unknown as SurveyRouteCoverageRepository;
    const surveyorRepo = {
        findActiveSurveyorByPublicId: async () => surveyorA,
        listActiveSurveyors: async () => [surveyorA],
    } as unknown as SurveyCoverageSurveyorRepository;

    const result = await new SurveyRouteCoverageService(coverageRepo, surveyorRepo).list(
        { surveyorPublicId: surveyorA.publicId },
        now
    );
    assert.equal(result.summary.totalActiveVariants, 2);
    assert.equal(result.summary.notStarted, 1);
    assert.equal(result.summary.finished, 1);
    assert.equal(result.summary.remaining, 1);
    assert.equal(result.summary.activeNow, 0);
    const d0 = result.items.find((item) => item.variantCode === "D0");
    const d1 = result.items.find((item) => item.variantCode === "D1");
    assert.equal(d0?.workStatus, "not_started");
    assert.equal(d1?.workStatus, "finished");
    assert.equal(d1?.variantReportCount, 3);
    assert.equal(d1?.presenceStatus, "offline");
});

test("work history includes unassigned sessions and does not duplicate on report count", async () => {
    const historyRepo = {
        countSessions: async () => 1,
        listSessions: async () => [
            {
                session_public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                client_session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                session_status: "completed",
                started_at: fresh,
                ended_at: now,
                last_activity_at: now,
                last_gps_at: now,
                last_lat: 16.8,
                last_lng: 96.1,
                last_gps_accuracy_m: 8,
                accumulated_active_seconds: 300,
                last_checked_stop_sequence: 4,
                checked_stop_count: 4,
                total_stop_count: 12,
                pending_sync_count: 0,
                client_sync_state: "SYNCED",
                route_public_id: "22222222-2222-4222-8222-222222222222",
                route_code: "YBS-1",
                route_variant_public_id: "33333333-3333-4333-8333-333333333333",
                direction_id: 0,
                report_count: 2,
                has_completion_row: false,
                is_finished: false,
                finished_at: null,
                reopened_at: null,
            },
        ],
        findSessionTimeline: async () => ({ session: null, events: [] }),
        countShortEmptySessions: async () => 0,
    } as unknown as SurveyWorkHistoryRepository;
    const surveyorRepo = {
        findActiveSurveyorByPublicId: async () => surveyorA,
        listActiveSurveyors: async () => [surveyorA],
    } as unknown as SurveyCoverageSurveyorRepository;

    const result = await new SurveyWorkHistoryService(historyRepo, surveyorRepo).list(
        { surveyorPublicId: surveyorA.publicId, page: 1, pageSize: 50, includeShortSessions: false },
        now
    );
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.reportCount, 2);
    assert.equal(result.items[0]?.currentCompletionStatus, "none");
    assert.equal(result.items[0]?.sessionStatus, "completed");
});

test("timeline keeps events separate from session row", async () => {
    const historyRepo = {
        countSessions: async () => 0,
        listSessions: async () => [],
        findSessionTimeline: async () => ({
            session: {
                session_public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                client_session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                surveyor_public_id: surveyorA.publicId,
                surveyor_display_name: surveyorA.displayName,
                surveyor_email: surveyorA.email,
                session_status: "completed",
                started_at: fresh,
                ended_at: now,
                last_activity_at: now,
                last_gps_at: now,
                last_lat: null,
                last_lng: null,
                last_gps_accuracy_m: null,
                accumulated_active_seconds: 60,
                last_checked_stop_sequence: 1,
                checked_stop_count: 1,
                total_stop_count: 5,
                pending_sync_count: 0,
                client_sync_state: null,
                route_public_id: "22222222-2222-4222-8222-222222222222",
                route_code: "YBS-1",
                route_variant_public_id: "33333333-3333-4333-8333-333333333333",
                direction_id: 0,
                report_count: 1,
                has_completion_row: true,
                is_finished: true,
                finished_at: now,
                reopened_at: null,
            },
            events: [
                {
                    event_type: "START",
                    occurred_at: fresh,
                    client_event_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                },
                {
                    event_type: "FINISH",
                    occurred_at: now,
                    client_event_id: null,
                },
            ],
        }),
    } as unknown as SurveyWorkHistoryRepository;
    const surveyorRepo = {
        findActiveSurveyorByPublicId: async () => surveyorA,
        listActiveSurveyors: async () => [surveyorA],
    } as unknown as SurveyCoverageSurveyorRepository;

    const result = await new SurveyWorkHistoryService(historyRepo, surveyorRepo).timeline(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        now
    );
    assert.equal(result.events.length, 2);
    assert.equal(result.session.currentCompletionStatus, "finished");
    assert.equal(result.session.reportCount, 1);
});

test("coverage summary counts remaining and active now", () => {
    const summary = summarizeRouteCoverage([
        { workStatus: "not_started", presenceStatus: "offline", remaining: true },
        { workStatus: "partial", presenceStatus: "live", remaining: true },
        { workStatus: "finished", presenceStatus: "offline", remaining: false },
    ]);
    assert.equal(summary.totalActiveVariants, 3);
    assert.equal(summary.remaining, 2);
    assert.equal(summary.activeNow, 1);
    assert.equal(summary.finished, 1);
});

test("one report remains one after multi-event session context", async () => {
    const coverageRepo = {
        listActiveVariantCoverage: async () => [
            {
                route_public_id: "22222222-2222-4222-8222-222222222222",
                route_code: "YBS-1",
                route_variant_public_id: "33333333-3333-4333-8333-333333333333",
                direction_id: 0,
                has_session: true,
                has_completion_row: false,
                is_finished: false,
                session_public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                session_status: "completed",
                session_started_at: fresh,
                last_activity_at: now,
                last_gps_at: now,
                accumulated_active_seconds: 90,
                last_checked_stop_sequence: null,
                checked_stop_count: 0,
                session_total_stop_count: 114,
                canonical_total_stop_count: 117,
                // Pre-aggregated DISTINCT count: 1 report despite 4 lifecycle events.
                latest_session_report_count: 1,
                variant_report_count: 1,
                pending_sync_count: 0,
                client_sync_state: "SYNCED",
            },
            {
                route_public_id: "22222222-2222-4222-8222-222222222222",
                route_code: "YBS-1",
                route_variant_public_id: "55555555-5555-4555-8555-555555555555",
                direction_id: 1,
                has_session: false,
                has_completion_row: false,
                is_finished: false,
                session_public_id: null,
                session_status: null,
                session_started_at: null,
                last_activity_at: null,
                last_gps_at: null,
                accumulated_active_seconds: null,
                last_checked_stop_sequence: null,
                checked_stop_count: null,
                session_total_stop_count: null,
                canonical_total_stop_count: 110,
                latest_session_report_count: 0,
                variant_report_count: 0,
                pending_sync_count: null,
                client_sync_state: null,
            },
        ],
    } as unknown as SurveyRouteCoverageRepository;
    const surveyorRepo = {
        findActiveSurveyorByPublicId: async () => surveyorA,
        listActiveSurveyors: async () => [surveyorA],
    } as unknown as SurveyCoverageSurveyorRepository;

    const result = await new SurveyRouteCoverageService(coverageRepo, surveyorRepo).list(
        { surveyorPublicId: surveyorA.publicId },
        now
    );
    const d0 = result.items.find((item) => item.variantCode === "D0");
    const d1 = result.items.find((item) => item.variantCode === "D1");
    assert.equal(d0?.variantReportCount, 1);
    assert.equal(d0?.latestSessionReportCount, 1);
    assert.equal(d0?.checkedLabel, "0 / 117");
    assert.equal(d1?.variantReportCount, 0);
});

test("multiple genuine reports count correctly and stay on their direction", async () => {
    const coverageRepo = {
        listActiveVariantCoverage: async () => [
            {
                route_public_id: "22222222-2222-4222-8222-222222222222",
                route_code: "YBS-1",
                route_variant_public_id: "33333333-3333-4333-8333-333333333333",
                direction_id: 0,
                has_session: true,
                has_completion_row: false,
                is_finished: false,
                session_public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                session_status: "completed",
                session_started_at: fresh,
                last_activity_at: now,
                last_gps_at: now,
                accumulated_active_seconds: 200,
                last_checked_stop_sequence: 2,
                checked_stop_count: 2,
                session_total_stop_count: 114,
                canonical_total_stop_count: 117,
                latest_session_report_count: 1,
                variant_report_count: 4,
                pending_sync_count: 0,
                client_sync_state: "SYNCED",
            },
            {
                route_public_id: "22222222-2222-4222-8222-222222222222",
                route_code: "YBS-1",
                route_variant_public_id: "55555555-5555-4555-8555-555555555555",
                direction_id: 1,
                has_session: true,
                has_completion_row: false,
                is_finished: false,
                session_public_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                session_status: "completed",
                session_started_at: fresh,
                last_activity_at: now,
                last_gps_at: now,
                accumulated_active_seconds: 100,
                last_checked_stop_sequence: 1,
                checked_stop_count: 1,
                session_total_stop_count: 100,
                canonical_total_stop_count: 110,
                latest_session_report_count: 2,
                variant_report_count: 2,
                pending_sync_count: 0,
                client_sync_state: "SYNCED",
            },
        ],
    } as unknown as SurveyRouteCoverageRepository;
    const surveyorRepo = {
        findActiveSurveyorByPublicId: async () => surveyorA,
        listActiveSurveyors: async () => [surveyorA],
    } as unknown as SurveyCoverageSurveyorRepository;

    const result = await new SurveyRouteCoverageService(coverageRepo, surveyorRepo).list(
        { surveyorPublicId: surveyorA.publicId },
        now
    );
    assert.equal(result.items.find((i) => i.variantCode === "D0")?.variantReportCount, 4);
    assert.equal(result.items.find((i) => i.variantCode === "D1")?.variantReportCount, 2);
});
