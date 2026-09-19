import assert from "node:assert/strict";
import test from "node:test";

import type { PlaceReviewsRepository } from "./place-reviews.repo.js";
import { PlaceReviewsService } from "./place-reviews.service.js";
import {
    FakePlaceReviewsRepository,
    PLACE_REVIEWS_TEST_PLACE_PUBLIC,
} from "./place-reviews.test-fixtures.js";

test("rating summary includes the confidence-adjusted review score", async () => {
    const repo = new FakePlaceReviewsRepository();
    const service = new PlaceReviewsService(repo as unknown as PlaceReviewsRepository);
    const summary = await service.refreshRatingSummary(PLACE_REVIEWS_TEST_PLACE_PUBLIC);

    assert.equal(summary.published_review_count, 0);
    assert.equal(summary.review_score, 50);
});
