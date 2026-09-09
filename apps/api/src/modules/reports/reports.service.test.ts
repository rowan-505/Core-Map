import assert from "node:assert/strict";
import test from "node:test";

import type { ReportMediaEvidenceRow } from "../media/media.repo.js";
import type { FieldRevisionParts } from "../field/field-revision.js";
import { snapshotRevisionFromParts } from "../field/field-revision.js";
import type { ReportRow } from "./reports.repo.js";
import { ReportsService } from "./reports.service.js";

const reportId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const stopId = "33333333-3333-4333-8333-333333333333";
const routeId = "11111111-1111-4111-8111-111111111111";

const liveParts: FieldRevisionParts = {
    routeCount: 1,
    variantCount: 2,
    stopCount: 2,
    routeStopCount: 4,
    pathCount: 2,
    routeStopSequenceSum: 10,
    maxRouteStopId: 40,
    maxUpdatedAtMs: 1_700_000_000_000,
};

function reportRow(overrides: Partial<ReportRow> = {}): ReportRow {
    return {
        id: 7n,
        public_id: reportId,
        created_by: 1n,
        anonymous_id: null,
        is_anonymous: false,
        eligible_for_points: false,
        report_type_code: "wrong_info",
        report_type_name: "Wrong information",
        status_code: "submitted",
        status_name: "Submitted",
        reason_code: null,
        target_entity_type: "stop",
        target_entity_id: 1n,
        target_public_id: stopId,
        title: null,
        description: "Note from surveyor",
        latitude: 16.81,
        longitude: 96.16,
        admin_area_id: null,
        priority: "normal",
        confidence_score: 40,
        reviewed_by: null,
        reviewed_at: null,
        admin_note: null,
        reward_ledger_id: null,
        reward_granted_at: null,
        created_at: new Date("2026-09-04T00:00:00.000Z"),
        updated_at: new Date("2026-09-04T00:00:00.000Z"),
        author_public_id: "user-1",
        author_display_name: "Surveyor",
        author_email: "s@example.com",
        source_code: "field_survey",
        observed_at: new Date("2026-09-04T01:00:00.000Z"),
        location_accuracy_m: 9,
        report_data: {
            snapshotRevision: "v1-capture",
            routePublicId: routeId,
            variantCode: "D0",
            stopPublicId: stopId,
            stopSequence: 3,
        },
        field_route_code: "YBS-13",
        field_stop_name: "First",
        field_origin_name: "A",
        field_destination_name: "B",
        survey_session_public_id: "66666666-6666-4666-8666-666666666666",
        survey_session_status: "completed",
        media_count: 0,
        ...overrides,
    };
}

function service(input: {
    report: ReportRow;
    media?: ReportMediaEvidenceRow[];
    parts?: FieldRevisionParts;
    affectedRoutes?: number;
    transport?: {
        applyMoveStopInTx?: (...args: never[]) => Promise<unknown>;
        applyRemoveStopFromVariantInTx?: (...args: never[]) => Promise<unknown>;
        applyCreateAndInsertStopInTx?: (...args: never[]) => Promise<unknown>;
        applyUpdateStopDetailsInTx?: (...args: never[]) => Promise<unknown>;
    };
}) {
    const prisma = {
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    };
    return new ReportsService(
        {
            findByPublicId: async () => input.report,
            listStatusEvents: async () => [],
            listFollowups: async () => [],
            findCanonicalStopPoint: async () => ({
                latitude: 16.8,
                longitude: 96.15,
                distance_m: 120,
            }),
            countAffectedRoutesForStop: async () => input.affectedRoutes ?? 1,
            findReviewNeighborStops: async () => ({
                previous: {
                    public_id: "22222222-2222-4222-8222-222222222221",
                    name: "Prev",
                    sequence: 2,
                },
                next: {
                    public_id: "22222222-2222-4222-8222-222222222223",
                    name: "Next",
                    sequence: 4,
                },
            }),
            findReviewMapWindow: async () => [
                {
                    public_id: "22222222-2222-4222-8222-222222222221",
                    name: "Prev",
                    sequence: 2,
                    latitude: 16.79,
                    longitude: 96.14,
                },
                {
                    public_id: stopId,
                    name: "First",
                    sequence: 3,
                    latitude: 16.8,
                    longitude: 96.15,
                },
                {
                    public_id: "22222222-2222-4222-8222-222222222223",
                    name: "Next",
                    sequence: 4,
                    latitude: 16.81,
                    longitude: 96.16,
                },
            ],
            lockByPublicIdForUpdate: async () => input.report,
            findByIdInTx: async () => input.report,
        } as never,
        {
            listReadyPrivateForReport: async () => input.media ?? [],
        } as never,
        {
            loadRevisionParts: async () => input.parts ?? liveParts,
        },
        prisma as never,
        {
            applyMoveStopInTx:
                input.transport?.applyMoveStopInTx ??
                (async () => ({
                    before: { latitude: 16.8, longitude: 96.15 },
                    after: { latitude: 16.9, longitude: 96.2 },
                    affectedVariantCount: 2,
                })),
            applyRemoveStopFromVariantInTx:
                input.transport?.applyRemoveStopFromVariantInTx ??
                (async () => ({
                    removedRouteStopId: "9",
                    removedSequence: 3,
                    resequencedCount: 4,
                    sequenceValid: true,
                })),
            applyCreateAndInsertStopInTx:
                input.transport?.applyCreateAndInsertStopInTx ??
                (async () => ({
                    stopPublicId: "55555555-5555-4555-8555-555555555555",
                    routeStopId: "11",
                    name: "Corner stall",
                    latitude: 16.91,
                    longitude: 96.21,
                })),
            applyUpdateStopDetailsInTx:
                input.transport?.applyUpdateStopDetailsInTx ??
                (async () => ({
                    before: { name: "Old", name_mm: "Old", name_en: null },
                    after: { name: "New", name_mm: "New", name_en: null },
                })),
        } as never
    );
}

test("adminGet returns stop-level field evidence without applying canonical writes", async () => {
    const detail = await service({ report: reportRow() }).adminGet(reportId);
    assert.equal(detail.field?.stop_public_id, stopId);
    assert.equal(detail.field?.variant_code, "D0");
    assert.equal(detail.field?.stop_sequence, 3);
    assert.equal(detail.canonical_target?.latitude, 16.8);
    assert.equal(detail.media.length, 0);
});

test("adminGet returns route-level field evidence", async () => {
    const detail = await service({
        report: reportRow({
            target_entity_type: "route",
            target_public_id: routeId,
            field_stop_name: null,
            report_data: {
                snapshotRevision: snapshotRevisionFromParts(liveParts),
                routePublicId: routeId,
                variantCode: "D1",
            },
        }),
    }).adminGet(reportId);
    assert.equal(detail.field?.route_public_id, routeId);
    assert.equal(detail.field?.variant_code, "D1");
    assert.equal(detail.field?.stop_public_id, null);
    assert.equal(detail.canonical_target, null);
});

test("adminGet MOVED geometry keeps observer and proposed points", async () => {
    const detail = await service({
        report: reportRow({
            report_type_code: "wrong_location",
            latitude: 16.9,
            longitude: 96.2,
            report_data: {
                snapshotRevision: "v1-capture",
                variantCode: "D0",
                stopPublicId: stopId,
                canonicalSnapshot: {
                    observerLat: 16.801,
                    observerLng: 96.151,
                    observerAccuracyM: 5,
                    correctedLat: 16.9,
                    correctedLng: 96.2,
                },
            },
        }),
    }).adminGet(reportId);
    assert.equal(detail.field?.observed_location?.latitude, 16.801);
    assert.equal(detail.field?.proposed_location?.latitude, 16.9);
    assert.equal(detail.canonical_target?.latitude, 16.8);
});

test("adminGet missing media stays an empty list", async () => {
    const detail = await service({ report: reportRow(), media: [] }).adminGet(reportId);
    assert.deepEqual(detail.media, []);
    assert.equal(detail.media_count, 0);
});

test("adminGet new_stop returns evidence and does not invent a canonical write", async () => {
    let canonicalLookups = 0;
    const reports = {
        findByPublicId: async () =>
            reportRow({
                report_type_code: "new_stop",
                report_type_name: "New stop",
                target_entity_type: "variant",
                target_public_id: "22222222-2222-4222-8222-222222222222",
                latitude: 16.91,
                longitude: 96.21,
                report_data: {
                    snapshotRevision: "v1-capture",
                    routePublicId: routeId,
                    variantCode: "D0",
                    previousStopPublicId: stopId,
                    previousStopSequence: 4,
                    proposedStopName: "Corner stall",
                    locationSource: "MAP_PICK",
                    stopPublicId: stopId,
                    stopSequence: 4,
                    canonicalSnapshot: {
                        observerLat: 16.801,
                        observerLng: 96.151,
                        observerAccuracyM: 40,
                        correctedLat: 16.91,
                        correctedLng: 96.21,
                    },
                },
            }),
        listStatusEvents: async () => [],
        listFollowups: async () => [],
        findCanonicalStopPoint: async () => {
            canonicalLookups += 1;
            return { latitude: 16.8, longitude: 96.15, distance_m: 80 };
        },
        countAffectedRoutesForStop: async () => 1,
        findReviewNeighborStops: async () => ({
            previous: { public_id: stopId, name: "First", sequence: 4 },
            next: null,
        }),
        findReviewMapWindow: async () => [
            {
                public_id: stopId,
                name: "First",
                sequence: 4,
                latitude: 16.8,
                longitude: 96.15,
            },
        ],
        insertStop: async () => {
            throw new Error("canonical write");
        },
    };
    const detail = await new ReportsService(
        reports as never,
        { listReadyPrivateForReport: async () => [] } as never,
        { loadRevisionParts: async () => liveParts },
        { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) } as never,
        {
            applyMoveStopInTx: async () => {
                throw new Error("canonical write");
            },
            applyRemoveStopFromVariantInTx: async () => {
                throw new Error("canonical write");
            },
            applyCreateAndInsertStopInTx: async () => {
                throw new Error("canonical write");
            },
            applyUpdateStopDetailsInTx: async () => {
                throw new Error("canonical write");
            },
        } as never
    ).adminGet(reportId);
    assert.equal(detail.report_type.code, "new_stop");
    assert.equal(detail.field?.proposed_stop_name, "Corner stall");
    assert.equal(detail.field?.location_source, "MAP_PICK");
    assert.equal(detail.field?.proposed_location?.latitude, 16.91);
    assert.equal(detail.field?.observed_location?.latitude, 16.801);
    assert.equal(detail.canonical_target?.latitude, 16.8);
    assert.equal(canonicalLookups, 1);
    assert.equal(detail.media.length, 0);
});

test("adminGet marks an old snapshot stale against the live revision", async () => {
    const detail = await service({ report: reportRow() }).adminGet(reportId);
    assert.equal(detail.field?.snapshot_revision, "v1-capture");
    assert.equal(detail.field?.current_snapshot_revision, snapshotRevisionFromParts(liveParts));
    assert.equal(detail.field?.snapshot_stale, true);
});

test("adminGet review model includes allowedActions and does not write canonical data", async () => {
    const detail = await service({
        report: reportRow({
            report_type_code: "wrong_location",
            status_code: "in_review",
            report_data: {
                snapshotRevision: "v1-capture",
                variantCode: "D0",
                variantPublicId: "22222222-2222-4222-8222-222222222222",
                stopPublicId: stopId,
                stopSequence: 3,
                canonicalSnapshot: {
                    correctedLat: 16.9,
                    correctedLng: 96.2,
                    observerLat: 16.801,
                    observerLng: 96.151,
                },
            },
        }),
        affectedRoutes: 3,
    }).adminGet(reportId);

    assert.ok(detail.review);
    assert.equal(detail.review.kind, "STOP_MOVED");
    assert.equal(detail.review.affected_route_count, 3);
    assert.equal(detail.review.coordinates.proposed?.latitude, 16.9);
    assert.equal(detail.review.previous_stop?.sequence, 2);
    assert.ok(detail.review.allowedActions.some((a) => a.action === "MOVE_STOP" && a.enabled === true));
    assert.ok(detail.review.allowedActions.some((a) => a.action === "RESOLVE" && a.enabled === true));
});

test("adminApply OPEN_ROUTE_EDITOR returns a client navigation hint without writes", async () => {
    const detail = await service({
        report: reportRow({
            report_type_code: "transport_issue",
            status_code: "in_review",
            target_entity_type: "route",
            target_public_id: routeId,
            field_stop_name: null,
            report_data: {
                snapshotRevision: "v1-capture",
                routePublicId: routeId,
                variantCode: "D0",
            },
        }),
    }).adminApply(
        reportId,
        {
            action: "OPEN_ROUTE_EDITOR",
            expectedCanonicalRevision: snapshotRevisionFromParts(liveParts),
        },
        { actorUserId: 1n, ipAddress: null, userAgent: null }
    );
    assert.equal(detail.applied, false);
    assert.equal(detail.client_action, "OPEN_ROUTE_EDITOR");
    assert.equal(detail.route_public_id, routeId);
    assert.equal(detail.idempotent, false);
});

test("adminApply rejects stale canonical revision before mutation", async () => {
    const svc = service({
        report: reportRow({
            report_type_code: "wrong_location",
            status_code: "in_review",
            report_data: {
                snapshotRevision: "v1-capture",
                variantCode: "D0",
                stopPublicId: stopId,
                canonicalSnapshot: { correctedLat: 16.9, correctedLng: 96.2 },
            },
        }),
    });
    await assert.rejects(
        () =>
            svc.adminApply(
                reportId,
                { action: "MOVE_STOP", expectedCanonicalRevision: "v1-stale" },
                { actorUserId: 1n, ipAddress: null, userAgent: null }
            ),
        (error: unknown) =>
            error instanceof Error && /Canonical revision mismatch/i.test(error.message)
    );
});
