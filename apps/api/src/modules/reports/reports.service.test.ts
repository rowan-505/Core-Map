import assert from "node:assert/strict";
import test from "node:test";

import type { ReportMediaEvidenceRow } from "../media/media.repo.js";
import type { FieldRevisionParts } from "../field/field-revision.js";
import { snapshotRevisionFromParts } from "../field/field-revision.js";
import type { ReportRow } from "./reports.repo.js";
import { adminReportDetailResponseSchema } from "./reports.schema.js";
import { ReportsService } from "./reports.service.js";

const reportId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const stopId = "33333333-3333-4333-8333-333333333333";
const routeId = "11111111-1111-4111-8111-111111111111";
const variantId = "22222222-2222-4222-8222-222222222222";

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
        author_public_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        author_display_name: "Surveyor",
        author_email: "s@example.com",
        source_code: "field_survey",
        observed_at: new Date("2026-09-04T01:00:00.000Z"),
        location_accuracy_m: 9,
        report_data: {
            snapshotRevision: "v1-capture",
            routePublicId: routeId,
            variantPublicId: variantId,
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
    context?: {
        stop: {
            id: string;
            publicId: string;
            name: string | null;
            coordinates: { latitude: number; longitude: number } | null;
            sequence: number | null;
        } | null;
        route: { id: string; publicId: string; code: string; name: string | null } | null;
        variant: {
            id: string;
            publicId: string;
            code: string;
            direction: string | null;
            originName: string | null;
            destinationName: string | null;
        } | null;
        previousStop: {
            id: string;
            publicId: string;
            name: string | null;
            coordinates: { latitude: number; longitude: number } | null;
            sequence: number | null;
        } | null;
        nextStop: {
            id: string;
            publicId: string;
            name: string | null;
            coordinates: { latitude: number; longitude: number } | null;
            sequence: number | null;
        } | null;
        affectedRoutes: Array<{
            routeId: string;
            routePublicId: string;
            routeCode: string;
            routeName: string | null;
            routeVariantId: string;
            routeVariantPublicId: string;
            variantCode: string;
            direction: string | null;
            sequence: number;
        }>;
        distanceObserverToCurrentMetres: number | null;
        distanceObserverToProposedMetres: number | null;
    };
    onContextCall?: () => void;
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
            getReportReviewContext: async () => {
                input.onContextCall?.();
                return (
                    input.context ?? {
                        stop: {
                            id: "10",
                            publicId: stopId,
                            name: "First",
                            coordinates: { latitude: 16.8, longitude: 96.15 },
                            sequence: 3,
                        },
                        route: { id: "20", publicId: routeId, code: "YBS-13", name: "YBS 13" },
                        variant: {
                            id: "30",
                            publicId: variantId,
                            code: "D0",
                            direction: "outbound",
                            originName: "A",
                            destinationName: "B",
                        },
                        previousStop: {
                            id: "9",
                            publicId: "22222222-2222-4222-8222-222222222221",
                            name: "Prev",
                            coordinates: { latitude: 16.79, longitude: 96.14 },
                            sequence: 2,
                        },
                        nextStop: {
                            id: "11",
                            publicId: "22222222-2222-4222-8222-222222222223",
                            name: "Next",
                            coordinates: { latitude: 16.81, longitude: 96.16 },
                            sequence: 4,
                        },
                        affectedRoutes: [
                            {
                                routeId: "20",
                                routePublicId: routeId,
                                routeCode: "YBS-13",
                                routeName: "YBS 13",
                                routeVariantId: "30",
                                routeVariantPublicId: variantId,
                                variantCode: "D0",
                                direction: "outbound",
                                sequence: 3,
                            },
                        ],
                        distanceObserverToCurrentMetres: 120,
                        distanceObserverToProposedMetres: 15,
                    }
                );
            },
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

test("adminGet returns one normalized complete stop review", async () => {
    const detail = await service({
        report: reportRow({
            report_type_code: "wrong_location",
            status_code: "in_review",
            report_data: {
                snapshotRevision: snapshotRevisionFromParts(liveParts),
                routePublicId: routeId,
                variantPublicId: variantId,
                stopPublicId: stopId,
                canonicalSnapshot: {
                    nameEn: "Survey name",
                    lat: 16.79,
                    lng: 96.14,
                    stopSequence: 3,
                    observerLat: 16.801,
                    observerLng: 96.151,
                    observerAccuracyM: 5,
                    correctedLat: 16.9,
                    correctedLng: 96.2,
                },
            },
        }),
    }).adminGet(reportId);

    assert.equal(detail.report.publicId, reportId);
    assert.equal(detail.resolvedTarget.stopPublicId, stopId);
    assert.equal(detail.comparison.original?.name, "Survey name");
    assert.equal(detail.comparison.current?.name, "First");
    assert.equal(detail.comparison.proposed?.coordinates?.latitude, 16.9);
    assert.equal(detail.observer?.distanceToCurrentStopMetres, 120);
    assert.deepEqual(detail.review.allowedActions, [
        "MOVE_STOP",
        "VERIFY_STOP",
        "REJECT_NO_CHANGE",
    ]);
    assert.equal(detail.review.suggestedAction, "MOVE_STOP");
    assert.deepEqual(detail.evidence.media, []);
});

test("adminGet resolves legacy report_data with null target_entity_id", async () => {
    const detail = await service({
        report: reportRow({ target_entity_id: null, target_public_id: null }),
    }).adminGet(reportId);
    assert.equal(detail.report.targetEntityId, null);
    assert.equal(detail.resolvedTarget.stopPublicId, stopId);
    assert.equal(detail.resolvedTarget.routeVariantPublicId, variantId);
});

test("adminGet keeps observer and report geometry separate from proposed geometry", async () => {
    const detail = await service({
        report: reportRow({
            report_type_code: "wrong_location",
            latitude: 16.9,
            longitude: 96.2,
            report_data: {
                snapshotRevision: snapshotRevisionFromParts(liveParts),
                variantPublicId: variantId,
                stopPublicId: stopId,
                canonicalSnapshot: {
                    observerLat: 16.801,
                    observerLng: 96.151,
                },
            },
        }),
    }).adminGet(reportId);
    assert.equal(detail.observer?.coordinates.latitude, 16.801);
    assert.equal(detail.comparison.proposed, null);
    assert.equal(detail.review.suggestedAction, null);
    assert.ok(detail.review.blockedReasons.includes("Valid proposed coordinates are missing"));
});

test("adminGet invalid corrected coordinate pair becomes null and blocks move", async () => {
    const detail = await service({
        report: reportRow({
            report_type_code: "wrong_location",
            report_data: {
                snapshotRevision: snapshotRevisionFromParts(liveParts),
                variantPublicId: variantId,
                stopPublicId: stopId,
                canonicalSnapshot: { correctedLat: 16.9 },
            },
        }),
    }).adminGet(reportId);
    assert.equal(detail.comparison.proposed, null);
    assert.ok(
        detail.review.blockedReasons.includes(
            "Proposed coordinates are incomplete or invalid"
        )
    );
});

test("adminGet new stop uses separate insertion context", async () => {
    const detail = await service({
        report: reportRow({
            report_type_code: "new_stop",
            report_type_name: "New stop",
            target_entity_type: "variant",
            target_entity_id: null,
            target_public_id: variantId,
            report_data: {
                snapshotRevision: snapshotRevisionFromParts(liveParts),
                routePublicId: routeId,
                variantPublicId: variantId,
                previousStopPublicId: stopId,
                proposedStopName: "Corner stall",
                locationSource: "MAP_PICK",
                canonicalSnapshot: {
                    observerLat: 16.801,
                    observerLng: 96.151,
                    correctedLat: 16.91,
                    correctedLng: 96.21,
                },
            },
        }),
    }).adminGet(reportId);
    assert.equal(detail.routeContext?.currentStop, null);
    assert.equal(detail.routeContext?.insertion?.afterStop?.publicId, stopId);
    assert.equal(detail.comparison.proposed?.name, "Corner stall");
    assert.equal(detail.review.suggestedAction, "CREATE_STOP_AND_INSERT");
});

test("adminGet missing transport target returns incomplete review", async () => {
    const detail = await service({
        report: reportRow(),
        context: {
            stop: null,
            route: null,
            variant: null,
            previousStop: null,
            nextStop: null,
            affectedRoutes: [],
            distanceObserverToCurrentMetres: null,
            distanceObserverToProposedMetres: null,
        },
    }).adminGet(reportId);
    assert.equal(detail.resolvedTarget.stopId, null);
    assert.equal(detail.routeContext, null);
    assert.ok(detail.review.blockedReasons.includes("Active target stop could not be resolved"));
});

test("adminGet missing snapshot revision is unknown rather than stale", async () => {
    const detail = await service({
        report: reportRow({ report_data: { variantPublicId: variantId, stopPublicId: stopId } }),
    }).adminGet(reportId);
    assert.equal(detail.comparison.snapshotRevision, null);
    assert.equal(detail.comparison.isStale, null);
    assert.ok(detail.review.blockedReasons.includes("Snapshot revision is missing"));
});

test("adminGet public report has empty field review and no transport lookup", async () => {
    let contextCalls = 0;
    const detail = await service({
        report: reportRow({
            source_code: "public",
            report_data: {},
            observed_at: null,
        }),
        onContextCall: () => {
            contextCalls += 1;
        },
    }).adminGet(reportId);
    assert.equal(contextCalls, 0);
    assert.equal(detail.routeContext, null);
    assert.deepEqual(detail.affectedRoutes, []);
    assert.deepEqual(detail.review, {
        allowedActions: [],
        suggestedAction: null,
        blockedReasons: [],
    });
});

test("adminGet performs one bounded transport repository call", async () => {
    let calls = 0;
    await service({
        report: reportRow(),
        onContextCall: () => {
            calls += 1;
        },
    }).adminGet(reportId);
    assert.equal(calls, 1);
});

test("adminGet deterministically orders affected routes and blocked reasons", async () => {
    const detail = await service({
        report: reportRow({
            report_type_code: "wrong_location",
            report_data: {
                snapshotRevision: "v1-stale",
                variantPublicId: variantId,
                stopPublicId: stopId,
            },
        }),
        context: {
            stop: {
                id: "10",
                publicId: stopId,
                name: "First",
                coordinates: { latitude: 16.8, longitude: 96.15 },
                sequence: 3,
            },
            route: { id: "20", publicId: routeId, code: "YBS-13", name: null },
            variant: {
                id: "30",
                publicId: variantId,
                code: "D0",
                direction: null,
                originName: null,
                destinationName: null,
            },
            previousStop: null,
            nextStop: null,
            affectedRoutes: [
                {
                    routeId: "21",
                    routePublicId: "11111111-1111-4111-8111-111111111112",
                    routeCode: "YBS-20",
                    routeName: null,
                    routeVariantId: "31",
                    routeVariantPublicId: "22222222-2222-4222-8222-222222222223",
                    variantCode: "D1",
                    direction: null,
                    sequence: 5,
                },
                {
                    routeId: "20",
                    routePublicId: routeId,
                    routeCode: "YBS-13",
                    routeName: null,
                    routeVariantId: "30",
                    routeVariantPublicId: variantId,
                    variantCode: "D0",
                    direction: null,
                    sequence: 3,
                },
            ],
            distanceObserverToCurrentMetres: null,
            distanceObserverToProposedMetres: null,
        },
    }).adminGet(reportId);

    assert.deepEqual(
        detail.affectedRoutes.map((item) => item.routeCode),
        ["YBS-13", "YBS-20"]
    );
    assert.deepEqual(detail.review.blockedReasons, [
        ...detail.review.blockedReasons,
    ].sort((a, b) => a.localeCompare(b, "en")));
});

test("strict detail schema rejects unexpected fields", async () => {
    const detail = await service({ report: reportRow() }).adminGet(reportId);
    assert.equal(
        adminReportDetailResponseSchema.safeParse({
            ...detail,
            unexpected: true,
        }).success,
        false
    );
});

test("adminGet media metadata never exposes private storage keys", async () => {
    const detail = await service({
        report: reportRow(),
        media: [
            {
                public_id: "77777777-7777-4777-8777-777777777777",
                mime_type: "image/jpeg",
                byte_size: 100,
                width: 10,
                height: 10,
                note: null,
                sort_order: 0,
                published: false,
                object_key: "private/secret.jpg",
            } as never,
        ],
    }).adminGet(reportId);
    assert.equal(detail.evidence.media.length, 1);
    assert.equal("object_key" in detail.evidence.media[0]!, false);
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
