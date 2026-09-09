import assert from "node:assert/strict";
import test from "node:test";

import { snapshotRevisionFromParts, type FieldRevisionParts } from "../field/field-revision.js";
import type { ReportRow } from "./reports.repo.js";
import { ReportsApplyError, ReportsApplyRepository } from "./reports-apply.repo.js";

const reportId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const stopId = "33333333-3333-4333-8333-333333333333";
const variantId = "22222222-2222-4222-8222-222222222222";
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

function report(overrides: Partial<ReportRow> = {}): ReportRow {
    return {
        id: 7n,
        public_id: reportId,
        created_by: 1n,
        anonymous_id: null,
        is_anonymous: false,
        eligible_for_points: false,
        report_type_code: "wrong_location",
        report_type_name: "Wrong location",
        status_code: "in_review",
        status_name: "In review",
        reason_code: null,
        target_entity_type: "stop",
        target_entity_id: 1n,
        target_public_id: stopId,
        title: null,
        description: "note",
        latitude: 16.9,
        longitude: 96.2,
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
            variantPublicId: variantId,
            variantCode: "D0",
            stopPublicId: stopId,
            stopSequence: 3,
            canonicalSnapshot: { correctedLat: 16.9, correctedLng: 96.2 },
        },
        field_route_code: "YBS-13",
        field_stop_name: "First",
        field_origin_name: "A",
        field_destination_name: "B",
        survey_session_public_id: null,
        survey_session_status: null,
        media_count: 0,
        ...overrides,
    };
}

function makeApplyRepo(input: {
    report: ReportRow;
    parts?: FieldRevisionParts;
    move?: (...args: unknown[]) => Promise<unknown>;
    remove?: (...args: unknown[]) => Promise<unknown>;
    create?: (...args: unknown[]) => Promise<unknown>;
    updateDetails?: (...args: unknown[]) => Promise<unknown>;
    onExecute?: (sql: string) => void;
}) {
    let current = input.report;
    const executed: string[] = [];
    const tx = {
        $executeRaw: async (strings: TemplateStringsArray | { strings?: unknown }) => {
            const text = Array.isArray(strings) ? strings.join("?") : "sql";
            executed.push(text);
            input.onExecute?.(text);
            if (typeof text === "string" && text.includes("status_code")) {
                current = {
                    ...current,
                    status_code: "resolved",
                    status_name: "Resolved",
                    report_data: {
                        ...(typeof current.report_data === "object" && current.report_data
                            ? (current.report_data as object)
                            : {}),
                        apply: { action: "MOVE_STOP" },
                    },
                };
            }
            return 1;
        },
        $queryRaw: async (strings: TemplateStringsArray | { strings?: unknown }) => {
            const text = Array.isArray(strings) ? strings.join("?") : "sql";
            if (text.includes("count(DISTINCT r.id)")) {
                return [{ count: 2 }];
            }
            if (text.includes("status_code =")) {
                return [{ id: current.id }];
            }
            return [];
        },
    };

    const prisma = {
        $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    };

    return {
        repo: new ReportsApplyRepository(
            prisma as never,
            {
                findByPublicId: async () => current,
                lockByPublicIdForUpdate: async () => current,
                findByIdInTx: async () => current,
            } as never,
            { loadRevisionParts: async () => input.parts ?? liveParts },
            {
                applyMoveStopInTx:
                    input.move ??
                    (async () => ({
                        before: { latitude: 16.8, longitude: 96.15 },
                        after: { latitude: 16.9, longitude: 96.2 },
                        affectedVariantCount: 3,
                    })),
                applyRemoveStopFromVariantInTx:
                    input.remove ??
                    (async () => ({
                        removedRouteStopId: "9",
                        removedSequence: 3,
                        resequencedCount: 4,
                        sequenceValid: true,
                    })),
                applyCreateAndInsertStopInTx:
                    input.create ??
                    (async () => ({
                        stopPublicId: "55555555-5555-4555-8555-555555555555",
                        routeStopId: "11",
                        name: "Corner stall",
                        latitude: 16.91,
                        longitude: 96.21,
                    })),
                applyUpdateStopDetailsInTx:
                    input.updateDetails ??
                    (async () => ({
                        before: { name: "Old", name_mm: "Old", name_en: null },
                        after: { name: "New", name_mm: "New", name_en: null },
                    })),
            } as never
        ),
        getCurrent: () => current,
        setCurrent: (next: ReportRow) => {
            current = next;
        },
        executed,
    };
}

const audit = { actorUserId: 1n, ipAddress: "127.0.0.1", userAgent: "test" };
const liveRev = () => snapshotRevisionFromParts(liveParts);

test("MOVE_STOP success updates comparison and resolves", async () => {
    const { repo } = makeApplyRepo({ report: report() });
    const result = await repo.apply({
        reportPublicId: reportId,
        action: "MOVE_STOP",
        expectedCanonicalRevision: liveRev(),
        audit,
    });
    assert.equal(result.applied, true);
    assert.equal(result.idempotent, false);
    assert.equal(result.comparison.affected_variant_count, 3);
    assert.deepEqual(result.comparison.after, { latitude: 16.9, longitude: 96.2 });
});

test("stale revision fails without calling transport write", async () => {
    let moved = 0;
    const { repo } = makeApplyRepo({
        report: report(),
        move: async () => {
            moved += 1;
            throw new Error("should not run");
        },
    });
    await assert.rejects(
        () =>
            repo.apply({
                reportPublicId: reportId,
                action: "MOVE_STOP",
                expectedCanonicalRevision: "v1-old",
                audit,
            }),
        (error: unknown) => error instanceof ReportsApplyError && error.statusCode === 409
    );
    assert.equal(moved, 0);
});

test("validation failure when proposed geometry missing", async () => {
    const { repo } = makeApplyRepo({
        report: report({
            report_data: {
                snapshotRevision: "v1-capture",
                stopPublicId: stopId,
                variantPublicId: variantId,
                variantCode: "D0",
            },
        }),
    });
    await assert.rejects(
        () =>
            repo.apply({
                reportPublicId: reportId,
                action: "MOVE_STOP",
                expectedCanonicalRevision: liveRev(),
                audit,
            }),
        (error: unknown) =>
            error instanceof ReportsApplyError && /proposed geometry/i.test(error.message)
    );
});

test("duplicate retry is idempotent and does not re-run mutation", async () => {
    let moved = 0;
    const applied = report({
        status_code: "resolved",
        status_name: "Resolved",
        report_data: {
            snapshotRevision: "v1-capture",
            stopPublicId: stopId,
            variantCode: "D0",
            canonicalSnapshot: { correctedLat: 16.9, correctedLng: 96.2 },
            apply: {
                action: "MOVE_STOP",
                comparison: {
                    before: { latitude: 16.8, longitude: 96.15 },
                    after: { latitude: 16.9, longitude: 96.2 },
                    affected_variant_count: 3,
                    affected_route_count: 2,
                },
            },
        },
    });
    const { repo } = makeApplyRepo({
        report: applied,
        move: async () => {
            moved += 1;
            return {
                before: { latitude: 16.8, longitude: 96.15 },
                after: { latitude: 16.9, longitude: 96.2 },
                affectedVariantCount: 3,
            };
        },
    });
    const result = await repo.apply({
        reportPublicId: reportId,
        action: "MOVE_STOP",
        expectedCanonicalRevision: liveRev(),
        audit,
    });
    assert.equal(result.idempotent, true);
    assert.equal(result.applied, true);
    assert.equal(moved, 0);
});

test("unauthorized action for report type is rejected", async () => {
    const { repo } = makeApplyRepo({
        report: report({ report_type_code: "other_map_issue", report_type_name: "Others" }),
    });
    await assert.rejects(
        () =>
            repo.apply({
                reportPublicId: reportId,
                action: "MOVE_STOP",
                expectedCanonicalRevision: liveRev(),
                audit,
            }),
        (error: unknown) =>
            error instanceof ReportsApplyError && /not permitted/i.test(error.message)
    );
});

test("transport failure rolls back by aborting the transaction", async () => {
    const { repo } = makeApplyRepo({
        report: report(),
        move: async () => {
            throw new Error("db write failed");
        },
    });
    await assert.rejects(
        () =>
            repo.apply({
                reportPublicId: reportId,
                action: "MOVE_STOP",
                expectedCanonicalRevision: liveRev(),
                audit,
            }),
        /db write failed/
    );
});

test("CREATE_AND_INSERT_STOP success returns created stop comparison", async () => {
    const { repo } = makeApplyRepo({
        report: report({
            report_type_code: "new_stop",
            report_type_name: "New stop",
            target_entity_type: "variant",
            target_public_id: variantId,
            report_data: {
                snapshotRevision: "v1-capture",
                routePublicId: routeId,
                variantPublicId: variantId,
                variantCode: "D0",
                previousStopPublicId: stopId,
                previousStopSequence: 4,
                proposedStopName: "Corner stall",
                locationSource: "GPS",
                canonicalSnapshot: { correctedLat: 16.91, correctedLng: 96.21 },
            },
        }),
    });
    const result = await repo.apply({
        reportPublicId: reportId,
        action: "CREATE_AND_INSERT_STOP",
        expectedCanonicalRevision: liveRev(),
        audit,
    });
    assert.equal(result.applied, true);
    assert.equal((result.comparison.after as { stop_public_id: string }).stop_public_id, "55555555-5555-4555-8555-555555555555");
});

test("RESOLVE without canonical change only updates lifecycle", async () => {
    let moved = 0;
    const { repo } = makeApplyRepo({
        report: report({ report_type_code: "other_map_issue" }),
        move: async () => {
            moved += 1;
            return null;
        },
    });
    const result = await repo.apply({
        reportPublicId: reportId,
        action: "RESOLVE",
        expectedCanonicalRevision: liveRev(),
        audit,
    });
    assert.equal(result.applied, true);
    assert.equal(moved, 0);
    assert.equal((result.comparison.after as { status_code: string }).status_code, "resolved");
});

test("REMOVE_FROM_ROUTE success preserves shared stop and resolves", async () => {
    let removed = 0;
    const { repo } = makeApplyRepo({
        report: report({
            report_type_code: "missing_item",
            report_type_name: "Missing item",
            report_data: {
                snapshotRevision: "v1-capture",
                routePublicId: routeId,
                variantPublicId: variantId,
                variantCode: "D0",
                stopPublicId: stopId,
                stopSequence: 3,
            },
        }),
        remove: async () => {
            removed += 1;
            return {
                removedRouteStopId: "9",
                removedSequence: 3,
                resequencedCount: 4,
                sequenceValid: true,
            };
        },
    });
    const result = await repo.apply({
        reportPublicId: reportId,
        action: "REMOVE_FROM_ROUTE",
        expectedCanonicalRevision: liveRev(),
        audit,
    });
    assert.equal(result.applied, true);
    assert.equal(removed, 1);
    assert.equal(result.comparison.affected_variant_count, 1);
    assert.equal((result.comparison.after as { sequence_valid: boolean }).sequence_valid, true);
});

test("UPDATE_STOP_DETAILS changes only structured proposed name fields", async () => {
    let updated = 0;
    const { repo } = makeApplyRepo({
        report: report({
            report_type_code: "wrong_info",
            report_type_name: "Wrong info",
            report_data: {
                snapshotRevision: "v1-capture",
                routePublicId: routeId,
                variantPublicId: variantId,
                variantCode: "D0",
                stopPublicId: stopId,
                stopSequence: 3,
                proposedStopName: "Renamed stop",
            },
        }),
        updateDetails: async (_tx: unknown, rawArgs: unknown) => {
            updated += 1;
            const args = rawArgs as { proposedStopName: string };
            assert.equal(args.proposedStopName, "Renamed stop");
            return {
                before: { name: "Old", name_mm: "Old", name_en: "Old EN" },
                after: { name: "Renamed stop", name_mm: "Renamed stop", name_en: "Old EN" },
            };
        },
    });
    const result = await repo.apply({
        reportPublicId: reportId,
        action: "UPDATE_STOP_DETAILS",
        expectedCanonicalRevision: liveRev(),
        audit,
    });
    assert.equal(result.applied, true);
    assert.equal(updated, 1);
    assert.equal((result.comparison.after as { name: string }).name, "Renamed stop");
    assert.equal((result.comparison.after as { name_en: string }).name_en, "Old EN");
});

test("REJECT without canonical change only updates lifecycle", async () => {
    let moved = 0;
    let removed = 0;
    const { repo } = makeApplyRepo({
        report: report({ report_type_code: "other_map_issue" }),
        move: async () => {
            moved += 1;
            return null;
        },
        remove: async () => {
            removed += 1;
            return null;
        },
    });
    const result = await repo.apply({
        reportPublicId: reportId,
        action: "REJECT",
        expectedCanonicalRevision: liveRev(),
        audit,
    });
    assert.equal(result.applied, true);
    assert.equal(moved, 0);
    assert.equal(removed, 0);
    assert.equal((result.comparison.after as { status_code: string }).status_code, "rejected");
});

test("rejected report retry is idempotent and does not re-run mutation", async () => {
    let removed = 0;
    const rejected = report({
        report_type_code: "missing_item",
        status_code: "rejected",
        status_name: "Rejected",
        report_data: {
            snapshotRevision: "v1-capture",
            stopPublicId: stopId,
            variantPublicId: variantId,
            variantCode: "D0",
            apply: {
                action: "REJECT",
                comparison: {
                    before: { status_code: "in_review" },
                    after: { status_code: "rejected" },
                    affected_variant_count: null,
                    affected_route_count: null,
                },
            },
        },
    });
    const { repo } = makeApplyRepo({
        report: rejected,
        remove: async () => {
            removed += 1;
            return null;
        },
    });
    const result = await repo.apply({
        reportPublicId: reportId,
        action: "REJECT",
        expectedCanonicalRevision: liveRev(),
        audit,
    });
    assert.equal(result.idempotent, true);
    assert.equal(result.applied, true);
    assert.equal(removed, 0);
});
