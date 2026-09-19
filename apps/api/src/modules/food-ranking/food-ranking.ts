/**
 * CoreMap Food & Drink Township Recommendations V1 — pure formula helpers.
 *
 * Logically separate from Tourism Ranking.
 * Township scope only. No editorial, season, type, editor_pick, or manual_boost.
 */

import { computeReviewScore } from "../place-reviews/place-reviews.scoring.js";

export const FOOD_DRINK_RANKING_ALGORITHM_VERSION = "coremap-food-drink-township-v1";

export const FOOD_DRINK_RANKING_GROUP = "food_drink" as const;

export type FoodDrinkRankingWeights = {
    readonly reviewWeight: number;
    readonly popularityWeight: number;
    readonly importanceWeight: number;
};

/** Township-only V1 weights. */
export const FOOD_DRINK_TOWNSHIP_V1_WEIGHTS: FoodDrinkRankingWeights = {
    reviewWeight: 0.5,
    popularityWeight: 0.3,
    importanceWeight: 0.2,
};

export type FoodDrinkRankingInputs = {
    readonly averageRating: number | null | undefined;
    readonly publishedReviewCount: number | null | undefined;
    readonly popularityScore: number | null | undefined;
    readonly importanceScore: number | null | undefined;
};

export type FoodDrinkRankingBreakdown = {
    readonly reviewScore: number;
    readonly popularityScore: number;
    readonly importanceScore: number;
    readonly foodScore: number;
};

const NEUTRAL = 50;

export function clampScore0to100(value: number): number {
    if (!Number.isFinite(value)) return NEUTRAL;
    if (value < 0) return 0;
    if (value > 100) return 100;
    return value;
}

export function normalizeImportanceScore(value: number | null | undefined): number {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return 0;
    }
    return clampScore0to100(Number(value));
}

export function resolvePopularityScore(value: number | null | undefined): number {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return NEUTRAL;
    }
    return clampScore0to100(Number(value));
}

/**
 * foodScore = reviewScore * 0.50 + popularityScore * 0.30 + importanceScore * 0.20
 */
export function computeFoodDrinkScore(input: {
    reviewScore: number;
    popularityScore: number;
    importanceScore: number;
    weights?: FoodDrinkRankingWeights;
}): number {
    const weights = input.weights ?? FOOD_DRINK_TOWNSHIP_V1_WEIGHTS;
    return (
        input.reviewScore * weights.reviewWeight +
        input.popularityScore * weights.popularityWeight +
        input.importanceScore * weights.importanceWeight
    );
}

export function computeFoodDrinkRankingBreakdown(
    input: FoodDrinkRankingInputs,
    weights: FoodDrinkRankingWeights = FOOD_DRINK_TOWNSHIP_V1_WEIGHTS
): FoodDrinkRankingBreakdown {
    const reviewScore = computeReviewScore(
        input.averageRating ?? null,
        Math.max(0, input.publishedReviewCount ?? 0)
    );
    const popularityScore = resolvePopularityScore(input.popularityScore);
    const importanceScore = normalizeImportanceScore(input.importanceScore);
    const foodScore = computeFoodDrinkScore({
        reviewScore,
        popularityScore,
        importanceScore,
        weights,
    });

    return {
        reviewScore,
        popularityScore,
        importanceScore,
        foodScore,
    };
}

export type FoodDrinkRankSortable = {
    readonly foodScore: number;
    readonly importanceScore: number;
    readonly reviewScore: number;
    readonly placeId: bigint | string | number;
};

/**
 * Sort: foodScore DESC, importance DESC, reviewScore DESC, place ID ASC.
 */
export function sortFoodDrinkRankingRows<T extends FoodDrinkRankSortable>(
    rows: readonly T[]
): T[] {
    return [...rows].sort((a, b) => {
        if (a.foodScore !== b.foodScore) return b.foodScore - a.foodScore;
        if (a.importanceScore !== b.importanceScore) {
            return b.importanceScore - a.importanceScore;
        }
        if (a.reviewScore !== b.reviewScore) return b.reviewScore - a.reviewScore;
        const aId = String(a.placeId);
        const bId = String(b.placeId);
        return aId < bId ? -1 : aId > bId ? 1 : 0;
    });
}

export function assertFoodWeightsSumToOne(weights: FoodDrinkRankingWeights): boolean {
    const sum = weights.reviewWeight + weights.popularityWeight + weights.importanceWeight;
    return Math.abs(sum - 1) < 0.0001;
}

/** Earth-surface distance in meters (display only; never used in ranking). */
export function haversineDistanceMeters(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const r = 6_371_000;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}
