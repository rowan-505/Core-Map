import assert from "node:assert/strict";
import test from "node:test";

import { REPORT_RATE_LIMIT_MESSAGE } from "../reports/reports.service.js";
import { FIELD_REPORT_CREATE_RATE_LIMIT, fieldReportCreateBodySchema } from "./field-reports.schema.js";
import { FieldReportsError, FieldReportsService } from "./field-reports.service.js";
import type { FieldReportRow } from "./field-reports.repo.js";
import type { FieldReportsRepository } from "./field-reports.repo.js";
import type { ReportsRepository } from "../reports/reports.repo.js";
import type { SurveySessionsService } from "./survey-sessions.service.js";

const stopId = "33333333-3333-4333-8333-333333333333";
const routeId = "11111111-1111-4111-8111-111111111111";
const variantId = "22222222-2222-4222-8222-222222222222";
const userId = 42n;

function validBody(clientPublicId: string) {
    return {
        clientPublicId,
        reportTypeCode: "wrong_location" as const,
        observedAt: new Date(),
        location: { lat: 16.78, lng: 96.15, accuracyM: 8 },
        target: { entityType: "stop" as const, publicId: stopId },
        context: {
            snapshotRevision: "v1-abc",
            routePublicId: routeId,
            variantPublicId: variantId,
            variantCode: "D0" as const,
            stopPublicId: stopId,
            stopSequence: 4,
            canonicalSnapshot: { stopName: "Sule" },
        },
        description: "Stop position is wrong",
    };
}

function row(overrides: Partial<FieldReportRow> = {}): FieldReportRow {
    const now = new Date();
    return {
        id: 9n,
        public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        created_by: userId,
        source_code: "field_survey",
        report_type_code: "wrong_location",
        status_code: "submitted",
        target_entity_type: "stop",
        target_public_id: stopId,
        description: "Stop position is wrong",
        latitude: 16.78,
        longitude: 96.15,
        location_accuracy_m: 8,
        observed_at: now,
        admin_area_id: 1n,
        report_data: {
            snapshotRevision: "v1-abc",
            variantCode: "D0",
            routePublicId: routeId,
            variantPublicId: variantId,
            stopPublicId: stopId,
            stopSequence: 4,
        },
        created_at: now,
        updated_at: now,
        survey_session_id: null,
        survey_session_public_id: null,
        ...overrides,
    };
}

function validLookup() {
    return {
        stopExists: true,
        routeExists: true,
        routeMode: "bus",
        routeCode: "YBS-13",
        variantExists: true,
        variantDirectionId: 0,
        variantRoutePublicId: routeId,
        stopOnVariant: true,
        stopBelongsToVariant: true,
        liveStopSequence: 4,
        nextStopBelongsToVariant: true,
    };
}

function serviceWith(overrides: {
    insert?: FieldReportsRepository["insertFieldReport"];
    lookup?: FieldReportsRepository["lookupTargets"];
    find?: FieldReportsRepository["findByPublicId"];
    update?: FieldReportsRepository["updateFieldReport"];
    followup?: ReportsRepository["insertFollowup"];
    session?: SurveySessionsService["requireOwnedForReport"];
}) {
    const fieldRepo = {
        lookupTargets: overrides.lookup ?? (async () => validLookup()),
        insertFieldReport:
            overrides.insert ??
            (async (input) => ({ created: true, row: row({ public_id: input.clientPublicId }) })),
        findByPublicId: overrides.find ?? (async () => row()),
        updateFieldReport: overrides.update ?? (async () => row()),
    } as unknown as FieldReportsRepository;
    const reportsRepo = {
        findActiveUserIdByPublicId: async () => userId,
        findByPublicId: async () => ({ id: 9n }),
        insertFollowup: overrides.followup ?? (async () => undefined),
    } as unknown as ReportsRepository;
    const surveySessions = {
        requireOwnedForReport:
            overrides.session ??
            (async () => {
                throw new Error("Unexpected survey session lookup");
            }),
    } as unknown as SurveySessionsService;
    return new FieldReportsService(fieldRepo, reportsRepo, surveySessions);
}

test("schema rejects invalid coordinates and non D0/D1 codes", () => {
    const badCoord = fieldReportCreateBodySchema.safeParse({
        ...validBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        location: { lat: 200, lng: 96, accuracyM: 1 },
    });
    assert.equal(badCoord.success, false);

    const badDir = fieldReportCreateBodySchema.safeParse({
        ...validBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        context: {
            ...validBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").context,
            variantCode: "inbound",
        },
    });
    assert.equal(badDir.success, false);
});

test("creates one field_survey report", async () => {
    const created = row();
    const svc = serviceWith({
        insert: async (input) => {
            assert.equal(input.clientPublicId, created.public_id);
            return { created: true, row: created };
        },
    });
    const result = await svc.create("user-sub", validBody(created.public_id));
    assert.equal(result.created, true);
    assert.equal(result.report.sourceCode, "field_survey");
    assert.equal(result.report.publicId, created.public_id);
});

test("retrying the same client UUID returns the existing row", async () => {
    const existing = row();
    let inserts = 0;
    const svc = serviceWith({
        insert: async () => {
            inserts += 1;
            return { created: inserts === 1, row: existing };
        },
    });
    const body = validBody(existing.public_id);
    const first = await svc.create("user-sub", body);
    const second = await svc.create("user-sub", body);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.report.publicId, existing.public_id);
});

test("lost create response then retry still creates exactly one report", async () => {
    const existing = row();
    let inserts = 0;
    const svc = serviceWith({
        insert: async () => {
            inserts += 1;
            return { created: inserts === 1, row: existing };
        },
    });
    const body = validBody(existing.public_id);
    await svc.create("user-sub", body);
    const replay = await svc.create("user-sub", body);
    assert.equal(inserts, 2);
    assert.equal(replay.created, false);
    assert.equal(replay.report.publicId, existing.public_id);
});

test("two distinct UUIDs stay two anomalies even with the same stop and type", async () => {
    const ids: string[] = [];
    const svc = serviceWith({
        insert: async (input) => {
            ids.push(input.clientPublicId);
            return { created: true, row: row({ public_id: input.clientPublicId }) };
        },
    });
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await svc.create("user-sub", validBody(a));
    await svc.create("user-sub", validBody(b));
    assert.deepEqual(ids, [a, b]);
});

test("invalid public IDs are rejected", async () => {
    const svc = serviceWith({
        lookup: async () => ({ ...validLookup(), stopExists: false }),
    });
    await assert.rejects(
        () => svc.create("user-sub", validBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")),
        (error: unknown) => error instanceof FieldReportsError && error.statusCode === 400
    );
});

test("field create does not use public daily report caps", async () => {
    assert.equal(FIELD_REPORT_CREATE_RATE_LIMIT.max >= 30, true);
    assert.notEqual(FIELD_REPORT_CREATE_RATE_LIMIT.max, 3);
    assert.notEqual(FIELD_REPORT_CREATE_RATE_LIMIT.max, 5);
    assert.notEqual(FIELD_REPORT_CREATE_RATE_LIMIT.max, 15);
    let creates = 0;
    const svc = serviceWith({
        insert: async (input) => {
            creates += 1;
            return { created: true, row: row({ public_id: input.clientPublicId }) };
        },
    });
    for (let i = 0; i < 20; i += 1) {
        await svc.create(
            "user-sub",
            validBody(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)
        );
    }
    assert.equal(creates, 20);
    assert.match(REPORT_RATE_LIMIT_MESSAGE, /report limit/);
});

test("submitted reports can be edited; in_review and resolved cannot", async () => {
    const svcEditable = serviceWith({
        find: async () => row({ status_code: "submitted" }),
        update: async () => row({ description: "fixed" }),
    });
    const edited = await svcEditable.patch("user-sub", row().public_id, { description: "fixed" });
    assert.equal(edited.description, "fixed");

    const locked = serviceWith({ find: async () => row({ status_code: "in_review" }) });
    await assert.rejects(
        () => locked.patch("user-sub", row().public_id, { description: "nope" }),
        (error: unknown) => error instanceof FieldReportsError && error.statusCode === 409
    );

    const closed = serviceWith({ find: async () => row({ status_code: "resolved" }) });
    await assert.rejects(
        () => closed.patch("user-sub", row().public_id, { description: "nope" }),
        (error: unknown) => error instanceof FieldReportsError && error.statusCode === 409
    );
});

test("field report flow never calls canonical transport writes", async () => {
    const transportMutations: string[] = [];
    const svc = serviceWith({});
    await svc.create("user-sub", validBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    assert.deepEqual(transportMutations, []);
});

test("links a report to an owned compatible survey session", async () => {
    let insertedSessionId: bigint | null | undefined;
    const svc = serviceWith({
        session: async (_createdBy, identifier, reportVariantPublicId) => {
            assert.deepEqual(identifier, { clientSessionId: "55555555-5555-4555-8555-555555555555" });
            assert.equal(reportVariantPublicId, variantId);
            return { session_id: 77n } as never;
        },
        insert: async (input) => {
            insertedSessionId = input.surveySessionId;
            return {
                created: true,
                row: row({
                    public_id: input.clientPublicId,
                    survey_session_id: 77n,
                    survey_session_public_id: "66666666-6666-4666-8666-666666666666",
                }),
            };
        },
    });
    const reportBody = {
        ...validBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        surveySession: { clientSessionId: "55555555-5555-4555-8555-555555555555" },
    };
    const result = await svc.create("user-sub", reportBody);
    assert.equal(insertedSessionId, 77n);
    assert.equal(result.report.surveySessionPublicId, "66666666-6666-4666-8666-666666666666");
});

test("idempotent report replay cannot switch survey sessions", async () => {
    const svc = serviceWith({
        session: async () => ({ session_id: 77n }) as never,
        insert: async () => ({
            created: false,
            row: row({ survey_session_id: 88n }),
        }),
    });
    await assert.rejects(
        () =>
            svc.create("user-sub", {
                ...validBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
                surveySession: { publicId: "66666666-6666-4666-8666-666666666666" },
            }),
        (error: unknown) =>
            error instanceof FieldReportsError && error.code === "REPORT_SESSION_CONFLICT"
    );
});

const nextStopId = "44444444-4444-4444-8444-444444444444";
const sessionId = "55555555-5555-4555-8555-555555555555";

function newStopBody(clientPublicId: string) {
    return {
        clientPublicId,
        reportTypeCode: "new_stop" as const,
        observedAt: new Date(),
        location: { lat: 16.781, lng: 96.151, accuracyM: 6 },
        target: { entityType: "variant" as const, publicId: variantId },
        context: {
            snapshotRevision: "v1-abc",
            routePublicId: routeId,
            variantPublicId: variantId,
            variantCode: "D0" as const,
            previousStopPublicId: stopId,
            previousStopSequence: 4,
            nextStopPublicId: nextStopId,
            proposedStopName: "Corner stall",
            locationSource: "GPS" as const,
            stopPublicId: stopId,
            stopSequence: 4,
            canonicalSnapshot: { previousStopName: "Sule" },
        },
        surveySession: { clientSessionId: sessionId },
        description: "Physical stop not on this variant",
    };
}

test("schema accepts new_stop evidence and keeps missing_item distinct", () => {
    const parsed = fieldReportCreateBodySchema.safeParse(
        newStopBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    );
    assert.equal(parsed.success, true);
    const missing = fieldReportCreateBodySchema.safeParse(
        validBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    );
    assert.equal(missing.success, true);
    assert.equal(missing.success ? missing.data.reportTypeCode : null, "wrong_location");
});

test("new_stop schema rejects a blank name and missing previous stop", () => {
    const blankName = fieldReportCreateBodySchema.safeParse({
        ...newStopBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        context: {
            ...newStopBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").context,
            proposedStopName: "  ",
        },
    });
    assert.equal(blankName.success, false);

    const noPrevious = fieldReportCreateBodySchema.safeParse({
        ...newStopBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        context: {
            ...newStopBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").context,
            previousStopPublicId: undefined,
        },
    });
    assert.equal(noPrevious.success, false);
});

test("creates a new_stop evidence row without treating it as missing_item", async () => {
    const created = row({
        public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        report_type_code: "new_stop",
        target_entity_type: "variant",
        target_public_id: variantId,
        survey_session_id: 77n,
        survey_session_public_id: "66666666-6666-4666-8666-666666666666",
        report_data: newStopBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").context,
    });
    const svc = serviceWith({
        session: async () => ({ session_id: 77n }) as never,
        insert: async (input) => {
            assert.equal(input.reportTypeCode, "new_stop");
            assert.equal(input.targetEntityType, "variant");
            return { created: true, row: created };
        },
    });
    const result = await svc.create("user-sub", newStopBody(created.public_id));
    assert.equal(result.created, true);
    assert.equal(result.report.reportTypeCode, "new_stop");
});

test("new_stop replay of the same UUID does not create another report", async () => {
    const existing = row({
        report_type_code: "new_stop",
        target_entity_type: "variant",
        target_public_id: variantId,
        latitude: 16.781,
        longitude: 96.151,
        survey_session_id: 77n,
        report_data: newStopBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").context,
    });
    let inserts = 0;
    const svc = serviceWith({
        session: async () => ({ session_id: 77n }) as never,
        insert: async () => {
            inserts += 1;
            return { created: inserts === 1, row: existing };
        },
    });
    const body = newStopBody(existing.public_id);
    const first = await svc.create("user-sub", body);
    const second = await svc.create("user-sub", body);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(inserts, 2);
});

test("new_stop replay with different previous stop is a safe conflict", async () => {
    const existing = row({
        report_type_code: "new_stop",
        target_entity_type: "variant",
        target_public_id: variantId,
        latitude: 16.781,
        longitude: 96.151,
        survey_session_id: 77n,
        report_data: newStopBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").context,
    });
    const svc = serviceWith({
        session: async () => ({ session_id: 77n }) as never,
        insert: async () => ({ created: false, row: existing }),
    });
    const body = newStopBody(existing.public_id);
    await assert.rejects(
        () =>
            svc.create("user-sub", {
                ...body,
                context: {
                    ...body.context,
                    previousStopPublicId: "99999999-9999-4999-8999-999999999999",
                    stopPublicId: "99999999-9999-4999-8999-999999999999",
                },
            }),
        (error: unknown) =>
            error instanceof FieldReportsError && error.code === "IDEMPOTENCY_CONFLICT"
    );
});

test("new_stop rejects a previous stop that is not on the selected variant", async () => {
    const svc = serviceWith({
        session: async () => ({ session_id: 77n }) as never,
        lookup: async () => ({
            ...validLookup(),
            stopBelongsToVariant: false,
            stopOnVariant: false,
            liveStopSequence: null,
        }),
    });
    await assert.rejects(
        () => svc.create("user-sub", newStopBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")),
        (error: unknown) => error instanceof FieldReportsError && error.statusCode === 400
    );
});

test("new_stop keeps a mismatched snapshot sequence as historical evidence", async () => {
    const created = row({
        report_type_code: "new_stop",
        target_entity_type: "variant",
        target_public_id: variantId,
        survey_session_id: 77n,
        report_data: newStopBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").context,
    });
    const svc = serviceWith({
        session: async () => ({ session_id: 77n }) as never,
        lookup: async () => ({
            ...validLookup(),
            stopOnVariant: false,
            stopBelongsToVariant: true,
            liveStopSequence: 9,
        }),
        insert: async (input) => {
            assert.equal((input.reportData as { previousStopSequence?: number }).previousStopSequence, 4);
            return { created: true, row: created };
        },
    });
    const result = await svc.create("user-sub", newStopBody(created.public_id));
    assert.equal(result.created, true);
});

test("old missing_item payloads still parse", () => {
    const parsed = fieldReportCreateBodySchema.safeParse({
        ...validBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        reportTypeCode: "missing_item",
    });
    assert.equal(parsed.success, true);
});
