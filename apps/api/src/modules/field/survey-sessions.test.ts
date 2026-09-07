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
                row({ status: input.status, ended_at: input.endedAt, updated_at: input.endedAt })),
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
