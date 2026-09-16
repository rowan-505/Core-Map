import assert from "node:assert/strict";
import test from "node:test";

import type {
    ActiveFieldVariantRow,
    SurveySessionRow,
    SurveySessionsRepository,
} from "./survey-sessions.repo.js";
import { decodeSurveySessionCursor } from "./survey-sessions.schema.js";
import { SurveySessionsError, SurveySessionsService } from "./survey-sessions.service.js";

const ownerId = 42n;
const otherOwnerId = 84n;
const clientSessionId = "11111111-1111-4111-8111-111111111111";
const sessionPublicId = "22222222-2222-4222-8222-222222222222";
const variantPublicId = "33333333-3333-4333-8333-333333333333";
const routePublicId = "44444444-4444-4444-8444-444444444444";
const startedAt = new Date("2026-09-04T01:00:00.000Z");

function variant(): ActiveFieldVariantRow {
    return {
        id: 7n,
        public_id: variantPublicId,
        route_public_id: routePublicId,
        route_code: "YBS-13",
        direction_id: 0,
        origin_name: "Sule",
        destination_name: "Hledan",
    };
}

function row(overrides: Partial<SurveySessionRow> = {}): SurveySessionRow {
    return {
        ...variant(),
        session_id: 9n,
        session_public_id: sessionPublicId,
        client_session_id: clientSessionId,
        created_by: ownerId,
        route_variant_id: 7n,
        snapshot_revision: "v1-abc",
        started_at: startedAt,
        ended_at: null,
        status: "active",
        tracking_state: "active",
        completion_status: "partial",
        accumulated_active_seconds: 0,
        finished_at: null,
        reopened_at: null,
        last_activity_at: startedAt,
        last_checked_stop_sequence: null,
        checked_stop_count: 0,
        total_stop_count: 12,
        pending_sync_count: 0,
        last_gps_accuracy_m: null,
        last_lat: null,
        last_lng: null,
        last_gps_at: null,
        client_sync_state: null,
        created_at: startedAt,
        updated_at: startedAt,
        report_count: 0n,
        ...overrides,
    };
}

function body() {
    return {
        clientSessionId,
        routeVariantPublicId: variantPublicId,
        snapshotRevision: "v1-abc",
        startedAt,
    };
}

function serviceWith(overrides: {
    userId?: bigint | null;
    activeVariant?: ActiveFieldVariantRow | null;
    insert?: SurveySessionsRepository["insert"];
    findPublic?: SurveySessionsRepository["findOwnedByPublicId"];
    findClient?: SurveySessionsRepository["findOwnedByClientSessionId"];
    findIdentifier?: SurveySessionsRepository["findOwnedByIdentifier"];
    end?: SurveySessionsRepository["end"];
    updateSummary?: SurveySessionsRepository["updateSummary"];
    finish?: SurveySessionsRepository["finish"];
    reopen?: SurveySessionsRepository["reopen"];
    list?: SurveySessionsRepository["listOwned"];
} = {}) {
    const repo = {
        findActiveUserIdByPublicId: async () =>
            overrides.userId === undefined ? ownerId : overrides.userId,
        findActiveFieldVariant: async () =>
            overrides.activeVariant === undefined ? variant() : overrides.activeVariant,
        insert:
            overrides.insert ??
            (async () => ({
                created: true,
                row: row(),
            })),
        findOwnedByPublicId: overrides.findPublic ?? (async () => row()),
        findOwnedByClientSessionId: overrides.findClient ?? (async () => row()),
        findOwnedByIdentifier: overrides.findIdentifier ?? (async () => row()),
        end:
            overrides.end ??
            (async (input) =>
                row({
                    status: input.status,
                    ended_at: input.endedAt,
                    tracking_state: "idle",
                    updated_at: input.endedAt,
                })),
        updateSummary:
            overrides.updateSummary ??
            (async (_id, _by, patch) =>
                row({
                    accumulated_active_seconds: patch.accumulatedActiveSeconds,
                    last_activity_at: patch.lastActivityAt,
                    last_checked_stop_sequence: patch.lastCheckedStopSequence,
                    checked_stop_count: patch.checkedStopCount,
                    total_stop_count: patch.totalStopCount,
                    pending_sync_count: patch.pendingSyncCount,
                    last_gps_accuracy_m: patch.lastGpsAccuracyM,
                    last_lat: patch.lastLat,
                    last_lng: patch.lastLng,
                    last_gps_at: patch.lastGpsAt,
                    client_sync_state: patch.clientSyncState,
                })),
        finish:
            overrides.finish ??
            (async (input) =>
                row({
                    completion_status: "finished",
                    finished_at: input.finishedAt,
                    status: "completed",
                    tracking_state: "idle",
                    ended_at: input.stoppedAt ?? input.finishedAt,
                })),
        reopen:
            overrides.reopen ??
            (async (input) =>
                row({
                    completion_status: "partial",
                    reopened_at: input.reopenedAt,
                    tracking_state: "idle",
                    finished_at: startedAt,
                })),
        listOwned: overrides.list ?? (async () => [row()]),
    } as unknown as SurveySessionsRepository;
    return new SurveySessionsService(repo);
}

test("creates an active zero-report session without exposing bigint ids", async () => {
    const result = await serviceWith().create("user-sub", body());
    assert.equal(result.created, true);
    assert.equal(result.session.status, "active");
    assert.equal(result.session.reportCount, 0);
    assert.deepEqual(result.session.route, { publicId: routePublicId, code: "YBS-13" });
    assert.deepEqual(result.session.variant, {
        publicId: variantPublicId,
        code: "D0",
        origin: "Sule",
        destination: "Hledan",
    });
    assert.equal("id" in result.session, false);
    assert.equal("routeVariantId" in result.session, false);
});

test("duplicate create is idempotent and preserves the original snapshot revision", async () => {
    const existing = row();
    const result = await serviceWith({
        insert: async () => ({ created: false, row: existing }),
    }).create("user-sub", body());
    assert.equal(result.created, false);
    assert.equal(result.session.snapshotRevision, "v1-abc");
});

test("duplicate client id with different immutable data returns a stable conflict", async () => {
    await assert.rejects(
        () =>
            serviceWith({
                insert: async () => ({
                    created: false,
                    row: row({ snapshot_revision: "v1-original" }),
                }),
            }).create("user-sub", body()),
        (error: unknown) =>
            error instanceof SurveySessionsError && error.code === "IDEMPOTENCY_CONFLICT"
    );
});

test("complete is retry-safe and keeps the first endedAt", async () => {
    const firstEnd = new Date("2026-09-04T02:00:00.000Z");
    let stored = row();
    let writes = 0;
    const service = serviceWith({
        findClient: async () => stored,
        end: async (input) => {
            writes += 1;
            stored = row({ status: "completed", ended_at: input.endedAt });
            return stored;
        },
    });
    const first = await service.complete("user-sub", clientSessionId, { endedAt: firstEnd });
    const retry = await service.complete("user-sub", clientSessionId, {
        endedAt: new Date("2026-09-04T03:00:00.000Z"),
    });
    assert.equal(writes, 1);
    assert.equal(first.endedAt, firstEnd.toISOString());
    assert.equal(retry.endedAt, firstEnd.toISOString());
});

test("abandon ends an active session", async () => {
    const endedAt = new Date("2026-09-04T02:00:00.000Z");
    const result = await serviceWith().abandon("user-sub", clientSessionId, { endedAt });
    assert.equal(result.status, "abandoned");
    assert.equal(result.endedAt, endedAt.toISOString());
});

test("unknown users are unauthorized", async () => {
    await assert.rejects(
        () => serviceWith({ userId: null }).create("missing-sub", body()),
        (error: unknown) =>
            error instanceof SurveySessionsError &&
            error.statusCode === 401 &&
            error.code === "UNAUTHORIZED"
    );
});

test("another user's session is hidden as not found", async () => {
    await assert.rejects(
        () => serviceWith({ findPublic: async () => null }).get("user-sub", sessionPublicId),
        (error: unknown) =>
            error instanceof SurveySessionsError &&
            error.statusCode === 404 &&
            error.code === "SESSION_NOT_FOUND"
    );
});

test("inactive or unknown route variants are rejected", async () => {
    await assert.rejects(
        () => serviceWith({ activeVariant: null }).create("user-sub", body()),
        (error: unknown) =>
            error instanceof SurveySessionsError && error.code === "INVALID_ROUTE_VARIANT"
    );
});

test("report association enforces ownership and route compatibility", async () => {
    const service = serviceWith({ findIdentifier: async () => row() });
    const linked = await service.requireOwnedForReport(
        ownerId,
        { clientSessionId },
        variantPublicId,
        new Date("2026-09-04T01:05:00.000Z")
    );
    assert.equal(linked.session_id, 9n);

    await assert.rejects(
        () => service.requireOwnedForReport(ownerId, { publicId: sessionPublicId }, routePublicId, new Date("2026-09-04T01:05:00.000Z")),
        (error: unknown) =>
            error instanceof SurveySessionsError && error.code === "SESSION_ROUTE_MISMATCH"
    );
    await assert.rejects(
        () =>
            serviceWith({ findIdentifier: async () => null }).requireOwnedForReport(
                otherOwnerId,
                { publicId: sessionPublicId },
                variantPublicId,
                new Date("2026-09-04T01:05:00.000Z")
            ),
        (error: unknown) =>
            error instanceof SurveySessionsError && error.code === "SESSION_NOT_FOUND"
    );
});

test("terminal sessions accept queued observations within their window and reject later reports", async () => {
    for (const status of ["completed", "abandoned"] as const) {
        const terminal = row({ status, ended_at: new Date("2026-09-04T01:10:00.000Z") });
        const linked = await serviceWith({ findIdentifier: async () => terminal }).requireOwnedForReport(
            ownerId,
            { clientSessionId },
            variantPublicId,
            new Date("2026-09-04T01:05:00.000Z")
        );
        assert.equal(linked.session_id, 9n);
        await assert.rejects(
            () =>
                serviceWith({ findIdentifier: async () => terminal }).requireOwnedForReport(
                    ownerId,
                    { clientSessionId },
                    variantPublicId,
                    new Date("2026-09-04T01:11:00.000Z")
                ),
            (error: unknown) =>
                error instanceof SurveySessionsError &&
                error.statusCode === 409 &&
                error.code === "REPORT_OUTSIDE_SESSION"
        );
    }
});

test("history uses opaque cursor pagination and computed report counts", async () => {
    const first = row({
        session_public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        started_at: new Date("2026-09-04T03:00:00.000Z"),
        report_count: 2n,
    });
    const second = row({
        session_public_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        started_at: new Date("2026-09-04T02:00:00.000Z"),
        report_count: 0n,
    });
    const extra = row({
        session_public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        started_at: new Date("2026-09-04T01:00:00.000Z"),
    });
    let receivedAfter: { startedAt: Date; publicId: string } | undefined;
    const service = serviceWith({
        list: async (input) => {
            receivedAfter = input.after;
            return input.after ? [extra] : [first, second, extra];
        },
    });
    const page = await service.list("user-sub", { limit: 2 });
    assert.deepEqual(page.items.map((item) => item.reportCount), [2, 0]);
    assert.ok(page.nextCursor);
    assert.deepEqual(decodeSurveySessionCursor(page.nextCursor!), {
        startedAt: second.started_at,
        publicId: second.session_public_id,
    });
    const next = await service.list("user-sub", { limit: 2, cursor: page.nextCursor! });
    assert.equal(receivedAfter?.publicId, second.session_public_id);
    assert.equal(next.items.length, 1);
    assert.equal(next.nextCursor, null);
});

test("finish is idempotent and stops tracking without requiring reports", async () => {
    const finishedAt = new Date("2026-09-04T02:00:00.000Z");
    let stored = row({ report_count: 0n });
    let writes = 0;
    const service = serviceWith({
        findClient: async () => stored,
        finish: async (input) => {
            writes += 1;
            stored = row({
                completion_status: "finished",
                finished_at: input.finishedAt,
                status: "completed",
                tracking_state: "idle",
                ended_at: input.finishedAt,
                report_count: 0n,
            });
            return stored;
        },
    });
    const first = await service.finish("user-sub", clientSessionId, { finishedAt });
    const retry = await service.finish("user-sub", clientSessionId, {
        finishedAt: new Date("2026-09-04T03:00:00.000Z"),
    });
    assert.equal(writes, 1);
    assert.equal(first.completionStatus, "finished");
    assert.equal(first.trackingState, "idle");
    assert.equal(first.reportCount, 0);
    assert.equal(retry.finishedAt, finishedAt.toISOString());
});

test("reopen returns partial without restarting tracking", async () => {
    const reopenedAt = new Date("2026-09-04T04:00:00.000Z");
    let stored = row({
        status: "completed",
        tracking_state: "idle",
        completion_status: "finished",
        finished_at: new Date("2026-09-04T02:00:00.000Z"),
        ended_at: new Date("2026-09-04T02:00:00.000Z"),
    });
    const service = serviceWith({
        findClient: async () => stored,
        reopen: async (input) => {
            stored = row({
                ...stored,
                completion_status: "partial",
                reopened_at: input.reopenedAt,
                tracking_state: "idle",
            });
            return stored;
        },
    });
    const result = await service.reopen("user-sub", clientSessionId, { reopenedAt });
    assert.equal(result.completionStatus, "partial");
    assert.equal(result.trackingState, "idle");
    assert.equal(result.reopenedAt, reopenedAt.toISOString());
});

test("summary sync accepts last gps only while tracking is active", async () => {
    const active = await serviceWith({
        findClient: async () => row({ tracking_state: "active" }),
        updateSummary: async (_id, _by, patch) =>
            row({
                tracking_state: "active",
                last_lat: patch.lastLat,
                last_lng: patch.lastLng,
                last_gps_accuracy_m: patch.lastGpsAccuracyM,
                checked_stop_count: patch.checkedStopCount,
            }),
    }).syncSummary("user-sub", clientSessionId, {
        accumulatedActiveSeconds: 60,
        lastActivityAt: new Date("2026-09-04T01:01:00.000Z"),
        checkedStopCount: 3,
        totalStopCount: 12,
        pendingSyncCount: 1,
        lastLat: 16.8,
        lastLng: 96.15,
        lastGpsAccuracyM: 8,
    });
    assert.equal(active.lastLat, 16.8);
    assert.equal(active.checkedStopCount, 3);

    const idle = await serviceWith({
        findClient: async () =>
            row({
                status: "completed",
                tracking_state: "idle",
                last_lat: 16.7,
                last_lng: 96.1,
                last_gps_accuracy_m: 5,
            }),
        updateSummary: async (_id, _by, patch) =>
            row({
                status: "completed",
                tracking_state: "idle",
                last_lat: patch.lastLat,
                last_lng: patch.lastLng,
                last_gps_accuracy_m: patch.lastGpsAccuracyM,
            }),
    }).syncSummary("user-sub", clientSessionId, {
        accumulatedActiveSeconds: 120,
        lastActivityAt: new Date("2026-09-04T01:02:00.000Z"),
        checkedStopCount: 3,
        totalStopCount: 12,
        pendingSyncCount: 0,
        lastLat: 16.9,
        lastLng: 96.2,
        lastGpsAccuracyM: 20,
    });
    assert.equal(idle.lastLat, 16.7);
    assert.equal(idle.lastGpsAccuracyM, 5);
});
