import assert from "node:assert/strict";
import test from "node:test";

import { computeReviewScore } from "./place-reviews.scoring.js";

test("computes confidence-adjusted review scores", () => {
    assert.equal(computeReviewScore(null, 0), 50);
    assert.equal(computeReviewScore(5, 1), 52.5);
    assert.equal(computeReviewScore(5, 5), 62.5);
    assert.equal(computeReviewScore(5, 20), 100);
    assert.equal(computeReviewScore(1, 1), 48.5);
});
