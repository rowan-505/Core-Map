import assert from "node:assert/strict";
import test from "node:test";

import {
    deriveSurveyActivityWorkStatus,
    isSurveyorActiveNow,
    summarizeSurveyActivity,
    surveyPresenceLabel,
} from "./survey-activity-status.js";
import type { SurveyActivityRepository } from "./survey-activity.repo.js";
import { SurveyActivityService } from "./survey-activity.service.js";

const now = new Date("2026-09-10T04:00:00.000Z");
const fresh = new Date("2026-09-10T03:59:00.000Z");
const stale = new Date("2026-09-10T03:50:00.000Z");

test("active now requires active session and fresh heartbeat", () => {
    assert.equal(
        isSurveyorActiveNow({
            sessionStatus: "active",
            heartbeatAtMs: fresh.getTime(),
            nowMs: now.getTime(),
        }),
        true
    );
    assert.equal(
        isSurveyorActiveNow({
            sessionStatus: "active",
            heartbeatAtMs: stale.getTime(),
            nowMs: now.getTime(),
        }),
        false
    );
    assert.equal(
        isSurveyorActiveNow({
            sessionStatus: "completed",
            heartbeatAtMs: fresh.getTime(),
            nowMs: now.getTime(),
        }),
        false
    );
});

test("stale heartbeat never claims Live or Active now", () => {
    const presence = surveyPresenceLabel({
        activeNow: false,
        lastSeenAt: stale.toISOString(),
    });
    assert.equal(presence.kind, "last_seen");
    assert.match(presence.label, /^Last seen /);
    assert.equal(presence.label.includes("Live"), false);
    assert.equal(presence.label.includes("Active now"), false);
});

test("D0 and D1 work status stay independent by finished/session flags", () => {
    assert.equal(
        deriveSurveyActivityWorkStatus({ hasSession: false, isFinished: false }),
        "not_started"
    );
    assert.equal(
        deriveSurveyActivityWorkStatus({ hasSession: true, isFinished: false }),
        "partial"
    );
    assert.equal(
        deriveSurveyActivityWorkStatus({ hasSession: true, isFinished: true }),
        "finished"
    );
});

test("zero-report finished sessions still count as finished remaining=false", async () => {
    const repo = {
        listActiveAssignments: async () => [
            {
                assignment_public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                surveyor_public_id: "11111111-1111-4111-8111-111111111111",
                surveyor_display_name: "Aung",
                surveyor_email: "aung@example.com",
                route_public_id: "22222222-2222-4222-8222-222222222222",
                route_code: "YBS-13",
                route_variant_public_id: "33333333-3333-4333-8333-333333333333",
                direction_id: 0,
                assigned_date: new Date("2026-09-10T00:00:00.000Z"),
                assignment_status: "active" as const,
                has_session: true,
                is_finished: true,
                session_public_id: "44444444-4444-4444-8444-444444444444",
                session_status: "completed",
                session_started_at: fresh,
                last_activity_at: stale,
                last_gps_at: stale,
                accumulated_active_seconds: 600,
                last_checked_stop_sequence: 18,
                checked_stop_count: 18,
                total_stop_count: 42,
                report_count: 0,
                pending_sync_count: 0,
                client_sync_state: "SYNCED",
            },
            {
                assignment_public_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                surveyor_public_id: "11111111-1111-4111-8111-111111111111",
                surveyor_display_name: "Aung",
                surveyor_email: "aung@example.com",
                route_public_id: "22222222-2222-4222-8222-222222222222",
                route_code: "YBS-13",
                route_variant_public_id: "55555555-5555-4555-8555-555555555555",
                direction_id: 1,
                assigned_date: new Date("2026-09-10T00:00:00.000Z"),
                assignment_status: "active" as const,
                has_session: false,
                is_finished: false,
                session_public_id: null,
                session_status: null,
                session_started_at: null,
                last_activity_at: null,
                last_gps_at: null,
                accumulated_active_seconds: null,
                last_checked_stop_sequence: null,
                checked_stop_count: null,
                total_stop_count: null,
                report_count: null,
                pending_sync_count: null,
                client_sync_state: null,
            },
        ],
    } as unknown as SurveyActivityRepository;

    const result = await new SurveyActivityService(repo).list({}, now);
    assert.equal(result.items.length, 2);
    const d0 = result.items.find((item) => item.variantCode === "D0");
    const d1 = result.items.find((item) => item.variantCode === "D1");
    assert.equal(d0?.workStatus, "finished");
    assert.equal(d0?.reportCount, 0);
    assert.equal(d0?.checkedLabel, "18 / 42");
    assert.equal(d0?.remaining, false);
    assert.equal(d0?.presence.activeNow, false);
    assert.match(d0?.presence.label ?? "", /^Last seen /);
    assert.equal(d1?.workStatus, "not_started");
    assert.equal(d1?.remaining, true);
    assert.equal(result.summary.finished, 1);
    assert.equal(result.summary.remaining, 1);
    assert.equal(result.summary.assigned, 2);
});

test("summary pending sync sums session pending counts", () => {
    const summary = summarizeSurveyActivity([
        {
            activeNow: true,
            workStatus: "partial",
            remaining: true,
            pendingSyncCount: 3,
        },
        {
            activeNow: false,
            workStatus: "finished",
            remaining: false,
            pendingSyncCount: 2,
        },
    ]);
    assert.equal(summary.activeNow, 1);
    assert.equal(summary.pendingSync, 5);
    assert.equal(summary.partial, 1);
    assert.equal(summary.finished, 1);
});
