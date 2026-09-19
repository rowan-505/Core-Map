import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TourismGeoRankingService } from "./tourism.geo-ranking.service.js";
import type { TourismGeoRankingCandidateRow } from "./tourism.repo.js";
import type { PlacePopularityService } from "../place-popularity/place-popularity.service.js";
import { computeTourismGeoRankingBreakdown, TOURISM_GEO_RANKING_V1_WEIGHTS } from "./tourism.geo-ranking.js";
import { postAdminTourismRankingPreviewBodySchema } from "./tourism.schema.js";

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

function makeService(candidates: TourismGeoRankingCandidateRow[]) {
    const repo = {
        findActiveRankingConfig: async () => null,
        listGeoRankingCandidates: async () => candidates,
    };
    const popularity = {
        computeContextScores: async () => ({
            context: "tourism_national",
            townshipAdminAreaId: null,
            regionAdminAreaId: null,
            windowDays: 30 as const,
            items: candidates.map((row, index) => ({
                placeId: String(row.placeId),
                rawActivity30d: 40 - index,
                popularityScore: index === 0 ? 100 : 20,
                coldStart: false,
            })),
        }),
        resolveTownshipAdminAreaIdForPlace: async () => null,
        resolveRegionAdminAreaIdForPlace: async () => null,
    };
    return new TourismGeoRankingService(
        repo as never,
        popularity as unknown as PlacePopularityService
    );
}

describe("TourismGeoRankingService previewRanking", () => {
    const a = candidate({
        placeId: 1n,
        publicId: "11111111-1111-4111-8111-111111111111",
        editorialScore: 50,
        importanceScore: 40,
        nameEn: "Alpha",
    });
    const b = candidate({
        placeId: 2n,
        publicId: "22222222-2222-4222-8222-222222222222",
        editorialScore: 80,
        importanceScore: 70,
        nameEn: "Beta",
    });

    it("preview with no proposed changes matches current", async () => {
        const service = makeService([a, b]);
        const preview = await service.previewRanking({
            place_public_id: a.publicId,
            scope: "national",
            proposed: {},
        });
        assert.equal(preview.has_changes, false);
        assert.equal(preview.current.rank, preview.preview.rank);
        assert.equal(preview.current.final_score, preview.preview.final_score);
        assert.equal(preview.current.base_score, preview.preview.base_score);
    });

    it("editorial change moves preview rank using authoritative math", async () => {
        const service = makeService([a, b]);
        const list = await service.listRanking({
            scope: "national",
            include_breakdown: true,
        });
        const before = list.items.find((item) => item.public_id === a.publicId);
        assert.ok(before);

        const preview = await service.previewRanking({
            place_public_id: a.publicId,
            scope: "national",
            proposed: { editorial_score: 95 },
        });
        assert.equal(preview.has_changes, true);
        assert.ok((preview.preview.rank ?? 99) < (preview.current.rank ?? 0));
        assert.ok((preview.preview.final_score ?? 0) > (preview.current.final_score ?? 0));

        const expected = computeTourismGeoRankingBreakdown(
            {
                editorialScore: 95,
                importanceScore: a.importanceScore,
                averageRating: null,
                publishedReviewCount: 0,
                popularityScore: 100,
                seasonMode: "all_year",
                seasonStartMonth: null,
                seasonEndMonth: null,
                manualBoost: 0,
                referenceMonth: undefined,
            },
            TOURISM_GEO_RANKING_V1_WEIGHTS.national,
            "national"
        );
        assert.equal(preview.preview.final_score, Math.round(expected.finalScore * 100) / 100);
    });

    it("season and boost overlays affect preview without accepting client final scores", async () => {
        const service = makeService([a, b]);
        const season = await service.previewRanking({
            place_public_id: a.publicId,
            scope: "national",
            reference_month: 1,
            proposed: {
                season_mode: "best_months",
                season_start_month: 11,
                season_end_month: 2,
            },
        });
        assert.equal(season.preview.season_modifier, 1.05);

        const boost = await service.previewRanking({
            place_public_id: a.publicId,
            scope: "national",
            proposed: { manual_boost: 5 },
        });
        assert.equal(boost.preview.manual_boost, 5);
        assert.ok((boost.preview.final_score ?? 0) > (boost.current.final_score ?? 0));
    });

    it("public list, admin list, and preview share identical math for same inputs", async () => {
        const service = makeService([a, b]);
        const publicPage = await service.listRanking({ scope: "national" });
        const adminPage = await service.listRanking({
            scope: "national",
            include_breakdown: true,
        });
        const preview = await service.previewRanking({
            place_public_id: b.publicId,
            scope: "national",
            proposed: {},
        });

        const publicItem = publicPage.items.find((item) => item.public_id === b.publicId);
        const adminItem = adminPage.items.find((item) => item.public_id === b.publicId);
        assert.ok(publicItem && adminItem);
        assert.equal(publicItem.rank, adminItem.rank);
        assert.equal(adminItem.rank, preview.current.rank);
        assert.ok("final_score" in adminItem);
        assert.equal(adminItem.final_score, preview.current.final_score);
        assert.equal(adminItem.base_score, preview.current.base_score);
        assert.equal(adminItem.review_score, preview.current.review_score);
    });
});

describe("postAdminTourismRankingPreviewBodySchema", () => {
    it("rejects calculated client fields", () => {
        const bad = postAdminTourismRankingPreviewBodySchema.safeParse({
            place_public_id: "11111111-1111-4111-8111-111111111111",
            scope: "national",
            proposed: { final_score: 99, rank: 1 },
        });
        assert.equal(bad.success, false);
    });

    it("requires admin_area_id for township and accepts editable fields only", () => {
        assert.equal(
            postAdminTourismRankingPreviewBodySchema.safeParse({
                place_public_id: "11111111-1111-4111-8111-111111111111",
                scope: "township",
                proposed: { editorial_score: 80 },
            }).success,
            false
        );
        const good = postAdminTourismRankingPreviewBodySchema.safeParse({
            place_public_id: "11111111-1111-4111-8111-111111111111",
            scope: "township",
            admin_area_id: "10",
            proposed: {
                editorial_score: 80,
                season_mode: "all_year",
                manual_boost: 2,
            },
        });
        assert.equal(good.success, true);
    });
});
