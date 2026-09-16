import assert from "node:assert/strict";
import test from "node:test";

import type { SurveyCompletionsRepository } from "./survey-completions.repo.js";
import { SurveyCompletionsError, SurveyCompletionsService } from "./survey-completions.service.js";

const ownerId = 42n;
const variantId = 7n;
const variantPublicId = "33333333-3333-4333-8333-333333333333";
const routePublicId = "44444444-4444-4444-8444-444444444444";
const at = new Date("2026-09-10T01:00:00.000Z");

function row(finished: boolean) {
    return {
        id: 1n,
        created_by: ownerId,
        route_variant_id: variantId,
        route_variant_public_id: variantPublicId,
        route_public_id: routePublicId,
        route_code: "YBS-13",
        direction_id: 0,
        is_finished: finished,
        finished_at: finished ? at : null,
        updated_at: at,
        created_at: at,
    };
}

function serviceWith(overrides: {
    userId?: bigint | null;
    variantId?: bigint | null;
    list?: SurveyCompletionsRepository["listOwned"];
    upsert?: SurveyCompletionsRepository["upsertOwned"];
} = {}) {
    const repo = {
        findActiveUserIdByPublicId: async () =>
            overrides.userId === undefined ? ownerId : overrides.userId,
        findActiveFieldVariantId: async () =>
            overrides.variantId === undefined ? variantId : overrides.variantId,
        listOwned: overrides.list ?? (async () => [row(true)]),
        upsertOwned:
            overrides.upsert ??
            (async (input) => row(input.finished)),
    } as unknown as SurveyCompletionsRepository;
    return new SurveyCompletionsService(repo);
}

test("lists owned completion marks without bigint ids", async () => {
    const result = await serviceWith().list("user-sub");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.finished, true);
    assert.equal(result.items[0]?.routeVariantPublicId, variantPublicId);
    assert.equal(result.items[0]?.variantCode, "D0");
    assert.equal("id" in result.items[0]!, false);
    assert.equal("routeVariantId" in result.items[0]!, false);
});

test("put finished true is idempotent for the surveyor variant pair", async () => {
    let writes = 0;
    const service = serviceWith({
        upsert: async (input) => {
            writes += 1;
            assert.equal(input.finished, true);
            return row(true);
        },
    });
    const first = await service.put("user-sub", variantPublicId, { finished: true });
    const second = await service.put("user-sub", variantPublicId, { finished: true });
    assert.equal(writes, 2);
    assert.equal(first.finished, true);
    assert.equal(second.finished, true);
    assert.equal(first.finishedAt, at.toISOString());
});

test("put finished false clears finishedAt", async () => {
    const result = await serviceWith({
        upsert: async (input) => {
            assert.equal(input.finished, false);
            return row(false);
        },
    }).put("user-sub", variantPublicId, { finished: false });
    assert.equal(result.finished, false);
    assert.equal(result.finishedAt, null);
});

test("invalid variant is rejected", async () => {
    await assert.rejects(
        () => serviceWith({ variantId: null }).put("user-sub", variantPublicId, { finished: true }),
        (error: unknown) =>
            error instanceof SurveyCompletionsError && error.code === "INVALID_ROUTE_VARIANT"
    );
});

test("unknown users are unauthorized", async () => {
    await assert.rejects(
        () => serviceWith({ userId: null }).list("missing"),
        (error: unknown) =>
            error instanceof SurveyCompletionsError &&
            error.statusCode === 401 &&
            error.code === "UNAUTHORIZED"
    );
});
