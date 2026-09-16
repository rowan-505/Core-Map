import assert from "node:assert/strict";
import test from "node:test";

import {
    deriveSurveyAssignmentWorkStatus,
    isSurveyAssignmentRemaining,
} from "./survey-assignment-status.js";
import type { SurveyAssignmentsRepository } from "./survey-assignments.repo.js";
import {
    SurveyAssignmentsError,
    SurveyAssignmentsService,
} from "./survey-assignments.service.js";

const surveyorId = 11n;
const managerId = 22n;
const variantId = 7n;
const assignmentPublicId = "55555555-5555-4555-8555-555555555555";
const surveyorPublicId = "11111111-1111-4111-8111-111111111111";
const managerPublicId = "22222222-2222-4222-8222-222222222222";
const variantPublicId = "33333333-3333-4333-8333-333333333333";
const routePublicId = "44444444-4444-4444-8444-444444444444";
const at = new Date("2026-09-10T01:00:00.000Z");

function row(overrides: Partial<{
    has_session: boolean;
    is_finished: boolean;
    status: "active" | "cancelled";
}> = {}) {
    return {
        id: 1n,
        public_id: assignmentPublicId,
        surveyor_user_id: surveyorId,
        surveyor_public_id: surveyorPublicId,
        assigned_by_user_id: managerId,
        assigned_by_public_id: managerPublicId,
        route_variant_id: variantId,
        route_variant_public_id: variantPublicId,
        route_public_id: routePublicId,
        route_code: "YBS-13",
        direction_id: 0,
        assigned_date: new Date("2026-09-10T00:00:00.000Z"),
        due_date: null,
        status: overrides.status ?? ("active" as const),
        cancelled_at: overrides.status === "cancelled" ? at : null,
        created_at: at,
        updated_at: at,
        has_session: overrides.has_session ?? false,
        is_finished: overrides.is_finished ?? false,
    };
}

function serviceWith(overrides: {
    list?: SurveyAssignmentsRepository["list"];
    create?: SurveyAssignmentsRepository["create"];
    update?: SurveyAssignmentsRepository["update"];
    cancel?: SurveyAssignmentsRepository["cancel"];
    findByPublicId?: SurveyAssignmentsRepository["findByPublicId"];
    surveyorId?: bigint | null;
    managerId?: bigint | null;
    variantId?: bigint | null;
} = {}) {
    const repo = {
        findActiveUserIdByPublicId: async (publicId: string) => {
            if (publicId === surveyorPublicId) return overrides.surveyorId === undefined ? surveyorId : overrides.surveyorId;
            if (publicId === managerPublicId) return overrides.managerId === undefined ? managerId : overrides.managerId;
            return null;
        },
        findActiveSurveyorUserIdByPublicId: async () =>
            overrides.surveyorId === undefined ? surveyorId : overrides.surveyorId,
        findActiveFieldVariantId: async () =>
            overrides.variantId === undefined ? variantId : overrides.variantId,
        list: overrides.list ?? (async () => [row()]),
        findByPublicId: overrides.findByPublicId ?? (async () => row()),
        create: overrides.create ?? (async () => row()),
        update: overrides.update ?? (async () => row()),
        cancel: overrides.cancel ?? (async () => row({ status: "cancelled" })),
    } as unknown as SurveyAssignmentsRepository;
    return new SurveyAssignmentsService(repo);
}

test("derive work status from session and completion", () => {
    assert.equal(
        deriveSurveyAssignmentWorkStatus({ hasSession: false, isFinished: false }),
        "not_started"
    );
    assert.equal(
        deriveSurveyAssignmentWorkStatus({ hasSession: true, isFinished: false }),
        "partial"
    );
    assert.equal(
        deriveSurveyAssignmentWorkStatus({ hasSession: false, isFinished: true }),
        "finished"
    );
    assert.equal(
        deriveSurveyAssignmentWorkStatus({ hasSession: true, isFinished: true }),
        "finished"
    );
    assert.equal(
        isSurveyAssignmentRemaining({ status: "active", workStatus: "partial" }),
        true
    );
    assert.equal(
        isSurveyAssignmentRemaining({ status: "active", workStatus: "finished" }),
        false
    );
});

test("surveyor lists only active owned assignments with work status", async () => {
    const result = await serviceWith({
        list: async (input) => {
            assert.equal(input.surveyorUserId, surveyorId);
            assert.equal(input.status, "active");
            return [row({ has_session: true, is_finished: false })];
        },
    }).list(surveyorPublicId, ["surveyor"], { status: "active" });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.workStatus, "partial");
    assert.equal(result.items[0]?.remaining, true);
    assert.equal(result.items[0]?.publicId, assignmentPublicId);
    assert.equal("id" in result.items[0]!, false);
});

test("surveyor cannot list cancelled assignment history", async () => {
    await assert.rejects(
        () =>
            serviceWith().list(surveyorPublicId, ["surveyor"], {
                status: "cancelled",
            }),
        (error: unknown) =>
            error instanceof SurveyAssignmentsError && error.code === "FORBIDDEN"
    );
});

test("manager create assigns D0/D1 by routeVariantPublicId", async () => {
    const created = await serviceWith({
        create: async (input) => {
            assert.equal(input.surveyorUserId, surveyorId);
            assert.equal(input.assignedByUserId, managerId);
            assert.equal(input.routeVariantId, variantId);
            assert.equal(input.assignedDate, "2026-09-10");
            return row();
        },
    }).create(managerPublicId, {
        surveyorPublicId,
        routeVariantPublicId: variantPublicId,
        assignedDate: "2026-09-10",
    });
    assert.equal(created.variantCode, "D0");
    assert.equal(created.workStatus, "not_started");
});

test("create rejects inactive variants", async () => {
    await assert.rejects(
        () =>
            serviceWith({ variantId: null }).create(managerPublicId, {
                surveyorPublicId,
                routeVariantPublicId: variantPublicId,
                assignedDate: "2026-09-10",
            }),
        (error: unknown) =>
            error instanceof SurveyAssignmentsError && error.code === "INVALID_ROUTE_VARIANT"
    );
});

test("cancel is idempotent for already cancelled rows", async () => {
    const result = await serviceWith({
        findByPublicId: async () => row({ status: "cancelled" }),
    }).cancel(assignmentPublicId);
    assert.equal(result.status, "cancelled");
    assert.equal(result.remaining, false);
});

test("finished assignments are not remaining", async () => {
    const result = await serviceWith({
        list: async () => [row({ has_session: true, is_finished: true })],
    }).list(surveyorPublicId, ["surveyor"], { status: "active" });
    assert.equal(result.items[0]?.workStatus, "finished");
    assert.equal(result.items[0]?.remaining, false);
});
