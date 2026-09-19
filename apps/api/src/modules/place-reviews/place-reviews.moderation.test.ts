import assert from "node:assert/strict";
import test from "node:test";

import { PlaceReviewsError } from "./place-reviews.errors.js";
import { resolvePlaceReviewAdminTransition } from "./place-reviews.moderation.js";

test("restores a previously published hidden review", () => {
    assert.deepEqual(
        resolvePlaceReviewAdminTransition("restore", {
            status: "hidden",
            publishedAt: new Date(),
        }),
        { idempotent: false, toStatus: "published" }
    );
});

test("does not moderate deleted reviews", () => {
    assert.throws(
        () =>
            resolvePlaceReviewAdminTransition("publish", {
                status: "deleted",
                publishedAt: null,
            }),
        PlaceReviewsError
    );
});
