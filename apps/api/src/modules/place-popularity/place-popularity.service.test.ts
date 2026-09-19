import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PlacePopularityService } from "./place-popularity.service.js";
import type { PlaceActivity30dRow, PlacePopularityRepository } from "./place-popularity.repo.js";
import { PLACE_POPULARITY_NEUTRAL_SCORE } from "./place-popularity.weights.js";

function makeRepo(overrides: Partial<PlacePopularityRepository> = {}): PlacePopularityRepository {
    return {
        incrementActivity: async () => undefined,
        findPlaceIdByPublicId: async () => 1n,
        resolveTownshipAdminAreaIdForPlace: async () => 100n,
        resolveRegionAdminAreaIdForPlace: async () => 200n,
        listActivity30dForContext: async () => [],
        toCounts: (row: PlaceActivity30dRow) => ({
            views: row.views,
            saves: row.saves,
            shares: row.shares,
            directions: row.directions,
        }),
        ...overrides,
    } as PlacePopularityRepository;
}

describe("PlacePopularityService context scoring", () => {
    it("resolves township from place id for tourism_township context", async () => {
        let seenTownship: bigint | null | undefined;
        const service = new PlacePopularityService(
            makeRepo({
                listActivity30dForContext: async (input) => {
                    seenTownship = input.townshipAdminAreaId;
                    return [
                        { placeId: 1n, views: 25, saves: 0, shares: 0, directions: 0 },
                        { placeId: 2n, views: 5, saves: 0, shares: 0, directions: 0 },
                    ];
                },
            })
        );

        const result = await service.computeContextScores({
            kind: "tourism_township",
            placeId: 9n,
        });

        assert.equal(seenTownship, 100n);
        assert.equal(result.townshipAdminAreaId, "100");
        assert.equal(result.items.find((i) => i.placeId === "1")?.popularityScore, 100);
        assert.equal(result.items.find((i) => i.placeId === "2")?.popularityScore, 0);
    });

    it("keeps food_drink and tourism populations separate", async () => {
        const tourismService = new PlacePopularityService(
            makeRepo({
                listActivity30dForContext: async () => [
                    { placeId: 1n, views: 30, saves: 0, shares: 0, directions: 0 },
                    { placeId: 2n, views: 10, saves: 0, shares: 0, directions: 0 },
                ],
            })
        );
        const foodService = new PlacePopularityService(
            makeRepo({
                listActivity30dForContext: async () => [
                    { placeId: 10n, views: 200, saves: 0, shares: 0, directions: 0 },
                    { placeId: 11n, views: 1, saves: 0, shares: 0, directions: 0 },
                ],
            })
        );

        const tourism = await tourismService.computeContextScores({
            kind: "tourism_township",
            townshipAdminAreaId: 1n,
        });
        const food = await foodService.computeContextScores({
            kind: "food_drink_township",
            townshipAdminAreaId: 1n,
        });

        assert.equal(tourism.items.find((i) => i.placeId === "1")?.popularityScore, 100);
        assert.equal(food.items.find((i) => i.placeId === "10")?.popularityScore, 100);
        assert.notDeepEqual(
            tourism.items.map((i) => i.placeId).sort(),
            food.items.map((i) => i.placeId).sort()
        );
    });

    it("applies cold start for sparse regional/national contexts", async () => {
        const service = new PlacePopularityService(
            makeRepo({
                listActivity30dForContext: async () => [
                    { placeId: 1n, views: 3, saves: 0, shares: 0, directions: 0 },
                    { placeId: 2n, views: 4, saves: 0, shares: 0, directions: 0 },
                ],
            })
        );

        const national = await service.computeContextScores({ kind: "tourism_national" });
        assert.ok(national.items.every((i) => i.popularityScore === PLACE_POPULARITY_NEUTRAL_SCORE));
        assert.ok(national.items.every((i) => i.coldStart));
    });
});
