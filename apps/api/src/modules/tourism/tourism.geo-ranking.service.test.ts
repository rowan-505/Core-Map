import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TourismGeoRankingService } from "./tourism.geo-ranking.service.js";
import type { TourismGeoRankingCandidateRow } from "./tourism.repo.js";
import type { PlacePopularityService } from "../place-popularity/place-popularity.service.js";

function candidate(
    overrides: Partial<TourismGeoRankingCandidateRow> &
        Pick<TourismGeoRankingCandidateRow, "placeId" | "publicId">
): TourismGeoRankingCandidateRow {
    return {
        displayName: "Place",
        primaryName: "Place",
        nameMm: null,
        nameEn: "Place",
        lat: 16.8,
        lng: 96.1,
        importanceScore: 50,
        isVerified: true,
        tourismType: "attraction",
        tourismTypeNameEn: "Attraction",
        tourismTypeNameMm: null,
        shortDescription: null,
        priceLevel: null,
        editorPick: false,
        editorialScore: 50,
        manualBoost: 0,
        seasonMode: "all_year",
        seasonStartMonth: null,
        seasonEndMonth: null,
        publishedReviewCount: 0,
        averageRating: null,
        townshipName: "Kyauktan",
        ...overrides,
    };
}

describe("TourismGeoRankingService", () => {
    it("ranks independently and excludes temporarily_closed", async () => {
        const repo = {
            findActiveRankingConfig: async () => null,
            listGeoRankingCandidates: async () => [
                candidate({
                    placeId: 1n,
                    publicId: "11111111-1111-4111-8111-111111111111",
                    editorialScore: 95,
                    importanceScore: 90,
                }),
                candidate({
                    placeId: 2n,
                    publicId: "22222222-2222-4222-8222-222222222222",
                    editorialScore: 20,
                    importanceScore: 10,
                }),
                candidate({
                    placeId: 3n,
                    publicId: "33333333-3333-4333-8333-333333333333",
                    editorialScore: 95,
                    importanceScore: 100,
                    seasonMode: "temporarily_closed",
                }),
            ],
        };

        const popularity = {
            computeContextScores: async () => ({
                context: "tourism_national",
                townshipAdminAreaId: null,
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
                    {
                        placeId: "3",
                        rawActivity30d: 80,
                        popularityScore: 100,
                        coldStart: false,
                    },
                ],
            }),
            resolveTownshipAdminAreaIdForPlace: async () => null,
            resolveRegionAdminAreaIdForPlace: async () => null,
        };

        const service = new TourismGeoRankingService(
            repo as never,
            popularity as unknown as PlacePopularityService
        );

        const page = await service.listRanking({
            scope: "national",
            include_breakdown: true,
            reference_month: 1,
        });

        assert.equal(page.total, 2);
        assert.equal(page.items[0]?.public_id, "11111111-1111-4111-8111-111111111111");
        assert.equal(page.items[0]?.rank, 1);
        assert.ok("final_score" in page.items[0]!);
        assert.ok("editorial_contribution" in page.items[0]!);
        assert.ok("algorithm_version" in page.items[0]!);
        assert.equal(
            page.items.some((i) => i.public_id === "33333333-3333-4333-8333-333333333333"),
            false
        );

        const preview = service.previewScore(
            {
                editorialScore: 95,
                importanceScore: 90,
                averageRating: null,
                publishedReviewCount: 0,
                popularityScore: 100,
                seasonMode: "all_year",
                seasonStartMonth: null,
                seasonEndMonth: null,
                manualBoost: 0,
                referenceMonth: 1,
            },
            "national"
        );
        assert.equal(
            (page.items[0] as { final_score: number }).final_score,
            Math.round(preview.finalScore * 100) / 100
        );
    });

    it("does not reuse township ranks as national input", async () => {
        const seenScopes: string[] = [];
        const repo = {
            findActiveRankingConfig: async () => null,
            listGeoRankingCandidates: async (input: { scope: string }) => {
                seenScopes.push(input.scope);
                return [
                    candidate({
                        placeId: 1n,
                        publicId: "11111111-1111-4111-8111-111111111111",
                        editorialScore: 80,
                        importanceScore: 40,
                    }),
                ];
            },
        };
        const popularity = {
            computeContextScores: async (input: { kind: string }) => {
                seenScopes.push(input.kind);
                return {
                    context: input.kind,
                    townshipAdminAreaId: null,
                    regionAdminAreaId: null,
                    windowDays: 30 as const,
                    items: [
                        {
                            placeId: "1",
                            rawActivity30d: 30,
                            popularityScore: 50,
                            coldStart: false,
                        },
                    ],
                };
            },
        };

        const service = new TourismGeoRankingService(
            repo as never,
            popularity as unknown as PlacePopularityService
        );

        await service.listRanking({
            scope: "township",
            admin_area_id: "10",
            include_breakdown: true,
        });
        await service.listRanking({ scope: "national", include_breakdown: true });

        assert.deepEqual(seenScopes, [
            "township",
            "tourism_township",
            "national",
            "tourism_national",
        ]);
    });
});
