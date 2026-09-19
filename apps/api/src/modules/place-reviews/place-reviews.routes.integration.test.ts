import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import placeReviewsRoutes from "./place-reviews.routes.js";
import type { PlaceReviewsService } from "./place-reviews.service.js";
import { PLACE_REVIEWS_TEST_PLACE_PUBLIC } from "./place-reviews.test-fixtures.js";

test("registers the universal public review route", async () => {
    const app = Fastify();
    app.decorate("authenticate", async () => {});
    app.decorate("requireRole", () => async () => {});

    const service = {
        listPublishedReviews: async () => ({ items: [], next_cursor: null }),
    } as unknown as PlaceReviewsService;

    await app.register(placeReviewsRoutes, { service });
    await app.ready();

    const response = await app.inject({
        method: "GET",
        url: `/places/${PLACE_REVIEWS_TEST_PLACE_PUBLIC}/reviews`,
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { items: [], next_cursor: null });
    await app.close();
});
