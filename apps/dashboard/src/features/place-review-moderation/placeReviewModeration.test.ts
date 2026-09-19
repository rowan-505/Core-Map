import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAdminPlaceReviewsPath,
  parseTourismStatusFilter,
  popCursorPage,
  pushCursorPage,
} from "./filters";
import {
  availableTourismActions,
  canRestoreTourismReview,
} from "./availableActions";

describe("universal place review moderation", () => {
  it("uses the universal admin reviews route and filters", () => {
    const path = buildAdminPlaceReviewsPath({
      status: "pending",
      placeId: "11111111-1111-4111-8111-111111111111",
      authorId: "22222222-2222-4222-8222-222222222222",
      cursor: "next",
      limit: 20,
    });
    assert.match(path, /^\/admin\/reviews\?/);
    assert.match(path, /status=pending/);
    assert.match(path, /placeId=11111111-1111-4111-8111-111111111111/);
    assert.match(path, /authorId=22222222-2222-4222-8222-222222222222/);
    assert.equal(parseTourismStatusFilter("unknown"), "all");
  });

  it("paginates and keeps deleted reviews non-restorable", () => {
    const stack = pushCursorPage([null], "next");
    assert.deepEqual(stack, [null, "next"]);
    assert.deepEqual(popCursorPage(stack), [null]);
    assert.equal(canRestoreTourismReview("hidden"), true);
    assert.equal(canRestoreTourismReview("deleted"), false);
    assert.deepEqual(availableTourismActions({ status: "deleted" }), []);
  });
});
