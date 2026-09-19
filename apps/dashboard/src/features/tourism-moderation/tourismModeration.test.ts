import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  availableTourismActions,
  canRestoreTourismReview,
  primaryTourismAction,
  secondaryTourismActions,
} from "./availableActions";
import {
  buildAdminTourismReviewsPath,
  buildTourismPlacesRankingPath,
  isPermissionDeniedError,
  parseTourismStatusFilter,
  permissionDeniedMessage,
  popCursorPage,
  pushCursorPage,
  resolveTourismListLoadingState,
} from "./filters";
import {
  buildEditorPickPatch,
  buildTourismProfilePayload,
  priceLevelFromVisitorCostCode,
  visitorCostCodeFromPriceLevel,
} from "./profileForm";
import { tourismHistoryLabel, tourismStatusLabel } from "./constants";

describe("tourism moderation loading / filters / pagination", () => {
  it("reports loading before the first page arrives", () => {
    assert.equal(
      resolveTourismListLoadingState({ isLoading: true, isError: false, itemCount: 0 }),
      "loading",
    );
    assert.equal(
      resolveTourismListLoadingState({ isLoading: false, isError: false, itemCount: 0 }),
      "empty",
    );
    assert.equal(
      resolveTourismListLoadingState({ isLoading: false, isError: false, itemCount: 3 }),
      "ready",
    );
  });

  it("builds status and place filters for the reviews queue", () => {
    assert.equal(parseTourismStatusFilter("pending"), "pending");
    assert.equal(parseTourismStatusFilter("nope"), "all");

    const path = buildAdminTourismReviewsPath({
      status: "pending",
      placeId: "11111111-1111-4111-8111-111111111111",
      authorId: "22222222-2222-4222-8222-222222222222",
      limit: 20,
      cursor: "c1",
    });
    assert.match(path, /status=pending/);
    assert.match(path, /placeId=11111111-1111-4111-8111-111111111111/);
    assert.match(path, /authorId=22222222-2222-4222-8222-222222222222/);
    assert.match(path, /limit=20/);
    assert.match(path, /cursor=c1/);
  });

  it("maps search q to placeId when it is a UUID", () => {
    const path = buildAdminTourismReviewsPath({
      q: "33333333-3333-4333-8333-333333333333",
    });
    assert.match(path, /placeId=33333333-3333-4333-8333-333333333333/);
    assert.equal(path.includes("q="), false);
  });

  it("paginates with a cursor stack", () => {
    let stack: (string | null)[] = [null];
    stack = pushCursorPage(stack, "next-1");
    assert.deepEqual(stack, [null, "next-1"]);
    stack = pushCursorPage(stack, "next-2");
    assert.deepEqual(stack, [null, "next-1", "next-2"]);
    stack = popCursorPage(stack);
    assert.deepEqual(stack, [null, "next-1"]);
    stack = popCursorPage(popCursorPage(stack));
    assert.deepEqual(stack, [null]);
  });

  it("builds places ranking path with mode and type filters", () => {
    const path = buildTourismPlacesRankingPath({
      mode: "editor_picks",
      tourism_type: "religious",
      limit: 20,
    });
    assert.match(path, /mode=editor_picks/);
    assert.match(path, /tourism_type=religious/);
  });
});

describe("tourism moderation permission denial", () => {
  it("detects 403 / forbidden errors for UI messaging", () => {
    assert.equal(
      isPermissionDeniedError(new Error("Request failed with status 403")),
      true,
    );
    assert.equal(isPermissionDeniedError(new Error("Forbidden")), true);
    assert.equal(isPermissionDeniedError(new Error("Not found")), false);
    assert.equal(
      permissionDeniedMessage(new Error("Request failed with status 403")),
      "You do not have permission to perform this action.",
    );
  });
});

describe("tourism moderation actions", () => {
  it("offers publish / reject / hide for pending", () => {
    assert.deepEqual(availableTourismActions({ status: "pending" }), [
      "publish",
      "reject",
      "hide",
    ]);
    assert.equal(primaryTourismAction(availableTourismActions({ status: "pending" })), "publish");
  });

  it("offers reject / hide for published", () => {
    assert.deepEqual(availableTourismActions({ status: "published" }), [
      "reject",
      "hide",
    ]);
  });

  it("offers restore only for hidden (never deleted)", () => {
    assert.deepEqual(availableTourismActions({ status: "hidden" }), [
      "publish",
      "reject",
      "restore",
    ]);
    assert.equal(canRestoreTourismReview("hidden"), true);
    assert.equal(canRestoreTourismReview("deleted"), false);
    assert.deepEqual(availableTourismActions({ status: "deleted" }), []);
    assert.deepEqual(
      secondaryTourismActions(availableTourismActions({ status: "hidden" })),
      ["reject", "restore"],
    );
  });

  it("supports reject and hide transitions from rejected", () => {
    assert.deepEqual(availableTourismActions({ status: "rejected" }), [
      "publish",
      "hide",
    ]);
  });
});

describe("tourism featured / visitor-cost profile form", () => {
  it("builds an editor-pick PATCH body", () => {
    assert.deepEqual(buildEditorPickPatch(true), { editor_pick: true });
    assert.deepEqual(buildEditorPickPatch(false), { editor_pick: false });
  });

  it("includes editor_pick in profile update payloads when toggled", () => {
    const previous = {
      tourism_type: "attraction",
      short_description: "",
      price_level: "unknown",
      editor_pick: false,
      is_public: true,
      editorial_score: "50",
      manual_boost: "0",
      season_mode: "all_year" as const,
      season_start_month: "",
      season_end_month: "",
    };
    const next = { ...previous, editor_pick: true };
    const built = buildTourismProfilePayload(next, { mode: "update", previous });
    assert.equal(built.ok, true);
    if (built.ok) {
      assert.deepEqual(built.patch, { editor_pick: true });
    }
  });

  it("maps visitor cost Free to price_level 0 and $–$$$$ to 1–4", () => {
    assert.equal(visitorCostCodeFromPriceLevel(null), "unknown");
    assert.equal(visitorCostCodeFromPriceLevel(0), "free");
    assert.equal(visitorCostCodeFromPriceLevel(2), "2");
    assert.deepEqual(priceLevelFromVisitorCostCode("free"), {
      ok: true,
      priceLevel: 0,
    });
    assert.deepEqual(priceLevelFromVisitorCostCode("3"), {
      ok: true,
      priceLevel: 3,
    });
  });

  it("builds taxonomy and factual inputs for profile creation", () => {
    const built = buildTourismProfilePayload(
      {
        tourism_type: "nature",
        short_description: "Forest reserve",
        price_level: "free",
        editor_pick: false,
        is_public: true,
        editorial_score: "80",
        manual_boost: "-3",
        season_mode: "best_months",
        season_start_month: "11",
        season_end_month: "2",
      },
      { mode: "create" },
    );
    assert.equal(built.ok, true);
    if (built.ok) {
      assert.deepEqual(built.create, {
        tourism_type: "nature",
        short_description: "Forest reserve",
        price_level: 0,
        editor_pick: false,
        is_public: true,
        editorial_score: 80,
        manual_boost: -3,
        season_mode: "best_months",
        season_start_month: 11,
        season_end_month: 2,
      });
    }
  });

  it("rejects free-text types and out-of-range ranking inputs", () => {
    const base = {
      tourism_type: "hotel",
      short_description: "",
      price_level: "unknown",
      editor_pick: false,
      is_public: true,
      editorial_score: "50",
      manual_boost: "0",
      season_mode: "all_year" as const,
      season_start_month: "",
      season_end_month: "",
    };
    assert.equal(buildTourismProfilePayload(base, { mode: "create" }).ok, false);
    assert.equal(
      buildTourismProfilePayload(
        { ...base, tourism_type: "museum", manual_boost: "11" },
        { mode: "create" },
      ).ok,
      false,
    );
  });
});

describe("tourism moderation history display", () => {
  it("formats status transitions for history rows", () => {
    assert.equal(tourismStatusLabel("pending"), "Pending");
    assert.equal(tourismHistoryLabel("pending", "published"), "Pending → Published");
    assert.equal(tourismHistoryLabel("published", "hidden"), "Published → Hidden");
    assert.equal(tourismHistoryLabel("hidden", "published"), "Hidden → Published");
    assert.equal(tourismHistoryLabel("pending", "rejected"), "Pending → Rejected");
  });
});
