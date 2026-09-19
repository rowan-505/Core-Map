import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FoodRankingService } from "./food-ranking.service.js";
import type { FoodDrinkRankingCandidateRow } from "./food-ranking.repo.js";
import type { PlacePopularityService } from "../place-popularity/place-popularity.service.js";

function candidate(
    overrides: Partial<FoodDrinkRankingCandidateRow> &
        Pick<FoodDrinkRankingCandidateRow, "placeId" | "publicId">
): FoodDrinkRankingCandidateRow {
    return {
        displayName: "Place",
        primaryName: "Place",
        nameMm: null,
        nameEn: "Place",
        lat: 16.8,
        lng: 96.1,
        importanceScore: 50,
        categoryCode: "restaurant",
        categoryName: "Restaurant",
        categoryNameMm: null,
        publishedReviewCount: 0,
        averageRating: null,
        ...overrides,
    };
}

describe("FoodRankingService", () => {
    it("ranks food places by foodScore and excludes nothing from tourism inputs", async () => {
        const repo = {
            findTownshipLabel: async () => ({
                id: "10",
                name: "Kyauktan",
                nameMm: null,
                nameEn: "Kyauktan",
            }),
            listTownshipCandidates: async () => [
                candidate({
                    placeId: 1n,
                    publicId: "11111111-1111-4111-8111-111111111111",
                    importanceScore: 90,
                    averageRating: 5,
                    publishedReviewCount: 20,
                    categoryCode: "restaurant",
                }),
                candidate({
                    placeId: 2n,
                    publicId: "22222222-2222-4222-8222-222222222222",
                    importanceScore: 10,
                    averageRating: 3,
                    publishedReviewCount: 2,
                    categoryCode: "cafe",
                    lat: 16.81,
                    lng: 96.11,
                }),
            ],
        };

        const popularity = {
            computeContextScores: async (input: { kind: string }) => {
                assert.equal(input.kind, "food_drink_township");
                return {
                    context: "food_drink_township",
                    townshipAdminAreaId: "10",
                    regionAdminAreaId: null,
                    windowDays: 30 as const,
                    items: [
                        {
                            placeId: "1",
                            rawActivity30d: 40,
                            popularityScore: 100,
                            coldStart: false,
                        },
                        {
                            placeId: "2",
                            rawActivity30d: 5,
                            popularityScore: 0,
                            coldStart: false,
                        },
                    ],
                };
            },
        };

        const service = new FoodRankingService(
            repo as never,
            popularity as unknown as PlacePopularityService
        );

        const page = await service.listRecommendations({
            township_admin_area_id: "10",
            include_breakdown: true,
            lat: 16.8,
            lng: 96.1,
        });

        assert.equal(page.ranking_group, "food_drink");
        assert.equal(page.scope, "township");
        assert.equal(page.total, 2);
        assert.equal(page.items[0]?.public_id, "11111111-1111-4111-8111-111111111111");
        assert.equal(page.items[0]?.rank, 1);
        assert.ok("food_score" in page.items[0]!);
        assert.equal(page.items[0]?.distance_meters, 0);
        assert.ok((page.items[1]?.distance_meters ?? 0) > 0);
        // High review confidence + popularity should beat low scores.
        assert.ok(
            (page.items[0] as { food_score: number }).food_score >
                (page.items[1] as { food_score: number }).food_score
        );
    });

    it("does not mix distance into ranking order", async () => {
        const repo = {
            findTownshipLabel: async () => ({
                id: "10",
                name: "Kyauktan",
                nameMm: null,
                nameEn: "Kyauktan",
            }),
            listTownshipCandidates: async () => [
                candidate({
                    placeId: 1n,
                    publicId: "11111111-1111-4111-8111-111111111111",
                    importanceScore: 100,
                    averageRating: 5,
                    publishedReviewCount: 20,
                    lat: 17.0,
                    lng: 97.0,
                }),
                candidate({
                    placeId: 2n,
                    publicId: "22222222-2222-4222-8222-222222222222",
                    importanceScore: 0,
                    averageRating: 1,
                    publishedReviewCount: 1,
                    lat: 16.8001,
                    lng: 96.1001,
                }),
            ],
        };
        const popularity = {
            computeContextScores: async () => ({
                context: "food_drink_township",
                townshipAdminAreaId: "10",
                regionAdminAreaId: null,
                windowDays: 30 as const,
                items: [
                    {
                        placeId: "1",
                        rawActivity30d: 50,
                        popularityScore: 100,
                        coldStart: false,
                    },
                    {
                        placeId: "2",
                        rawActivity30d: 1,
                        popularityScore: 0,
                        coldStart: false,
                    },
                ],
            }),
        };

        const service = new FoodRankingService(
            repo as never,
            popularity as unknown as PlacePopularityService
        );
        const page = await service.listRecommendations({
            township_admin_area_id: "10",
            lat: 16.8,
            lng: 96.1,
        });

        // Far high-score place still ranks first; near low-score place is second.
        assert.equal(page.items[0]?.public_id, "11111111-1111-4111-8111-111111111111");
        assert.ok((page.items[0]?.distance_meters ?? 0) > (page.items[1]?.distance_meters ?? 0));
    });
});
