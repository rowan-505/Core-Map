import assert from "node:assert/strict";
import test from "node:test";

import {
    createPlaceReviewBodySchema,
    placeReviewPlaceIdParamSchema,
    updatePlaceReviewBodySchema,
} from "./place-reviews.schema.js";

test("validates universal place review input", () => {
    assert.equal(createPlaceReviewBodySchema.safeParse({ rating: 5 }).success, true);
    assert.equal(createPlaceReviewBodySchema.safeParse({ rating: 0 }).success, false);
    assert.equal(updatePlaceReviewBodySchema.safeParse({}).success, false);
});

test("requires a public UUID place id", () => {
    assert.equal(
        placeReviewPlaceIdParamSchema.safeParse({
            placeId: "11111111-1111-4111-8111-111111111111",
        }).success,
        true
    );
    assert.equal(placeReviewPlaceIdParamSchema.safeParse({ placeId: "1" }).success, false);
});
