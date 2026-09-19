import type { PrismaClient } from "@prisma/client";

import { deriveCoalescedDisplayName, trimName } from "../../lib/entity-names/derive-display-name.js";
import { PlacePopularityService } from "../place-popularity/place-popularity.service.js";
import { FoodRankingError } from "./food-ranking.errors.js";
import {
    computeFoodDrinkRankingBreakdown,
    FOOD_DRINK_RANKING_ALGORITHM_VERSION,
    FOOD_DRINK_TOWNSHIP_V1_WEIGHTS,
    haversineDistanceMeters,
    sortFoodDrinkRankingRows,
} from "./food-ranking.js";
import {
    FoodRankingRepository,
    type FoodDrinkRankingCandidateRow,
} from "./food-ranking.repo.js";

export type FoodDrinkRecommendationsQuery = {
    township_admin_area_id: string;
    limit?: number;
    offset?: number;
    lang?: "my" | "en";
    lat?: number;
    lng?: number;
    include_breakdown?: boolean;
};

export type FoodDrinkRankedPlacePublicDto = {
    rank: number;
    public_id: string;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    lat: number;
    lng: number;
    category_code: string;
    category_name: string;
    category_name_mm: string | null;
    average_rating: number | null;
    published_review_count: number;
    distance_meters: number | null;
};

export type FoodDrinkRankedPlaceAdminDto = FoodDrinkRankedPlacePublicDto & {
    review_score: number;
    popularity_score: number;
    importance_score: number;
    food_score: number;
};

export type FoodDrinkRecommendationsPageDto = {
    ranking_group: "food_drink";
    scope: "township";
    algorithm_version: string;
    township_admin_area_id: string;
    township_name: string | null;
    total: number;
    limit: number;
    offset: number;
    items: Array<FoodDrinkRankedPlacePublicDto | FoodDrinkRankedPlaceAdminDto>;
};

type ScoredRow = {
    candidate: FoodDrinkRankingCandidateRow;
    foodScore: number;
    importanceScore: number;
    reviewScore: number;
    placeId: bigint;
    breakdown: ReturnType<typeof computeFoodDrinkRankingBreakdown>;
};

export class FoodRankingService {
    constructor(
        private readonly repo: FoodRankingRepository,
        private readonly popularity: PlacePopularityService
    ) {}

    static create(prisma: PrismaClient): FoodRankingService {
        return new FoodRankingService(
            new FoodRankingRepository(prisma),
            PlacePopularityService.create(prisma)
        );
    }

    async listRecommendations(
        query: FoodDrinkRecommendationsQuery
    ): Promise<FoodDrinkRecommendationsPageDto> {
        if (!/^\d+$/.test(query.township_admin_area_id)) {
            throw new FoodRankingError(
                "township_admin_area_id is required",
                400,
                "INVALID_TOWNSHIP"
            );
        }

        const townshipAdminAreaId = BigInt(query.township_admin_area_id);
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
        const offset = Math.max(query.offset ?? 0, 0);
        const includeBreakdown = query.include_breakdown === true;
        const hasOrigin =
            typeof query.lat === "number" &&
            Number.isFinite(query.lat) &&
            typeof query.lng === "number" &&
            Number.isFinite(query.lng);

        const [township, candidates, popularityResult] = await Promise.all([
            this.repo.findTownshipLabel(townshipAdminAreaId),
            this.repo.listTownshipCandidates(townshipAdminAreaId),
            this.popularity.computeContextScores({
                kind: "food_drink_township",
                townshipAdminAreaId,
            }),
        ]);

        if (!township) {
            throw new FoodRankingError("Township not found", 404, "TOWNSHIP_NOT_FOUND");
        }

        const popularityByPlace = new Map(
            popularityResult.items.map((item) => [item.placeId, item.popularityScore])
        );

        const scored: ScoredRow[] = [];
        for (const candidate of candidates) {
            const breakdown = computeFoodDrinkRankingBreakdown(
                {
                    averageRating: candidate.averageRating,
                    publishedReviewCount: candidate.publishedReviewCount,
                    popularityScore: popularityByPlace.get(String(candidate.placeId)) ?? 50,
                    importanceScore: candidate.importanceScore,
                },
                FOOD_DRINK_TOWNSHIP_V1_WEIGHTS
            );
            scored.push({
                candidate,
                foodScore: breakdown.foodScore,
                importanceScore: breakdown.importanceScore,
                reviewScore: breakdown.reviewScore,
                placeId: candidate.placeId,
                breakdown,
            });
        }

        const sorted = sortFoodDrinkRankingRows(scored);
        const pageRows = sorted.slice(offset, offset + limit);
        const townshipName = resolveTownshipDisplayName(township, query.lang);

        const items = pageRows.map((row, index) =>
            this.toDto({
                row,
                rank: offset + index + 1,
                lang: query.lang,
                includeBreakdown,
                originLat: hasOrigin ? query.lat : undefined,
                originLng: hasOrigin ? query.lng : undefined,
            })
        );

        return {
            ranking_group: "food_drink",
            scope: "township",
            algorithm_version: FOOD_DRINK_RANKING_ALGORITHM_VERSION,
            township_admin_area_id: String(townshipAdminAreaId),
            township_name: townshipName,
            total: sorted.length,
            limit,
            offset,
            items,
        };
    }

    private toDto(input: {
        row: ScoredRow;
        rank: number;
        lang: "my" | "en" | undefined;
        includeBreakdown: boolean;
        originLat?: number;
        originLng?: number;
    }): FoodDrinkRankedPlacePublicDto | FoodDrinkRankedPlaceAdminDto {
        const c = input.row.candidate;
        const nameMm = trimName(c.nameMm);
        const nameEn = trimName(c.nameEn);
        const displayName = trimName(c.displayName);
        const primaryName = trimName(c.primaryName);
        const fallback = displayName ?? primaryName ?? "Unnamed Place";
        const name =
            input.lang === "en"
                ? (nameEn ?? nameMm ?? fallback)
                : input.lang === "my"
                  ? (nameMm ?? nameEn ?? fallback)
                  : (deriveCoalescedDisplayName({
                        name_mm: nameMm,
                        name_en: nameEn,
                        fallback_name: fallback,
                    }) ?? fallback);

        let distanceMeters: number | null = null;
        if (
            typeof input.originLat === "number" &&
            typeof input.originLng === "number" &&
            Number.isFinite(c.lat) &&
            Number.isFinite(c.lng)
        ) {
            distanceMeters = Math.round(
                haversineDistanceMeters(input.originLat, input.originLng, c.lat, c.lng)
            );
        }

        const base: FoodDrinkRankedPlacePublicDto = {
            rank: input.rank,
            public_id: c.publicId,
            name,
            name_mm: nameMm,
            name_en: nameEn,
            lat: c.lat,
            lng: c.lng,
            category_code: c.categoryCode,
            category_name: c.categoryName,
            category_name_mm: c.categoryNameMm,
            average_rating: c.averageRating,
            published_review_count: c.publishedReviewCount,
            distance_meters: distanceMeters,
        };

        if (!input.includeBreakdown) return base;

        return {
            ...base,
            review_score: input.row.breakdown.reviewScore,
            popularity_score: input.row.breakdown.popularityScore,
            importance_score: input.row.breakdown.importanceScore,
            food_score: input.row.breakdown.foodScore,
        };
    }
}

function resolveTownshipDisplayName(
    township: {
        name: string;
        nameMm: string | null;
        nameEn: string | null;
    },
    lang: "my" | "en" | undefined
): string {
    if (lang === "en") return township.nameEn ?? township.nameMm ?? township.name;
    if (lang === "my") return township.nameMm ?? township.nameEn ?? township.name;
    return township.nameMm ?? township.nameEn ?? township.name;
}
