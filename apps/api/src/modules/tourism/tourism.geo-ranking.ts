/**
 * CoreMap Tourism Ranking V1 — single authoritative formula module.
 *
 * algorithm_version = coremap-tourism-ranking-v1
 *
 * All public ranking, admin ranking, preview, breakdown, and tests MUST use
 * these helpers. Do not duplicate this formula in dashboard or other apps.
 *
 * Independent geographic scopes only (township / region / national).
 * Never feed township rank into region/national (or region into national).
 */

import { computeReviewScore } from "../place-reviews/place-reviews.scoring.js";

export const TOURISM_GEO_RANKING_ALGORITHM_VERSION = "coremap-tourism-ranking-v1";

export const TOURISM_GEO_RANKING_SCOPES = ["township", "region", "national"] as const;
export type TourismGeoRankingScope = (typeof TOURISM_GEO_RANKING_SCOPES)[number];

export type TourismRankingWeights = {
    readonly editorialWeight: number;
    readonly importanceWeight: number;
    readonly reviewWeight: number;
    readonly popularityWeight: number;
};

/** Canonical V1 weights (also seeded in tourism.ranking_configs). */
export const TOURISM_GEO_RANKING_V1_WEIGHTS: Record<
    TourismGeoRankingScope,
    TourismRankingWeights
> = {
    township: {
        editorialWeight: 0.5,
        importanceWeight: 0.25,
        reviewWeight: 0.15,
        popularityWeight: 0.1,
    },
    region: {
        editorialWeight: 0.4,
        importanceWeight: 0.3,
        reviewWeight: 0.15,
        popularityWeight: 0.15,
    },
    national: {
        editorialWeight: 0.3,
        importanceWeight: 0.4,
        reviewWeight: 0.15,
        popularityWeight: 0.15,
    },
};

export type TourismSeasonMode =
    | "all_year"
    | "best_months"
    | "poor_months"
    | "temporarily_closed";

export type TourismGeoRankingInputs = {
    readonly editorialScore: number | null | undefined;
    readonly importanceScore: number | null | undefined;
    readonly averageRating: number | null | undefined;
    readonly publishedReviewCount: number | null | undefined;
    readonly popularityScore: number | null | undefined;
    readonly seasonMode: TourismSeasonMode;
    readonly seasonStartMonth: number | null | undefined;
    readonly seasonEndMonth: number | null | undefined;
    readonly manualBoost: number | null | undefined;
    /** 1–12; defaults to current UTC month when omitted. */
    readonly referenceMonth?: number;
};

/**
 * Full explainable breakdown for one place in one independent scope.
 * Numeric fields used for ranking keep full precision.
 * Use {@link roundTourismScoreForDisplay} only when serializing for API display.
 */
export type TourismGeoRankingBreakdown = {
    readonly algorithmVersion: string;
    readonly scope: TourismGeoRankingScope;
    readonly editorialScore: number;
    readonly editorialWeight: number;
    readonly editorialContribution: number;
    readonly importanceScore: number;
    readonly importanceWeight: number;
    readonly importanceContribution: number;
    readonly reviewScore: number;
    readonly reviewWeight: number;
    readonly reviewContribution: number;
    readonly popularityScore: number;
    readonly popularityWeight: number;
    readonly popularityContribution: number;
    readonly seasonMode: TourismSeasonMode;
    readonly seasonModifier: number;
    readonly manualBoost: number;
    readonly baseScore: number;
    readonly seasonAdjustedScore: number;
    readonly finalScore: number;
    readonly excluded: boolean;
};

const NEUTRAL = 50;
const WEIGHT_SUM_EPSILON = 0.0001;

/** Clamp any score-like value into the project 0–100 range. */
export function clampScore0to100(value: number): number {
    if (!Number.isFinite(value)) return NEUTRAL;
    if (value < 0) return 0;
    if (value > 100) return 100;
    return value;
}

/**
 * Display rounding only. Never feed rounded values back into ranking math.
 * Policy: round half away from zero to 2 decimal places.
 */
export function roundTourismScoreForDisplay(value: number): number {
    if (!Number.isFinite(value)) return NEUTRAL;
    return Math.round(value * 100) / 100;
}

/**
 * Importance stays on core.core_places; for ranking we only normalize a copy.
 * Existing semantics are 0–100 style scores; values outside are clamped.
 */
export function normalizeImportanceScore(value: number | null | undefined): number {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return 0;
    }
    return clampScore0to100(Number(value));
}

export function resolveEditorialScore(value: number | null | undefined): number {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return NEUTRAL;
    }
    return clampScore0to100(Number(value));
}

export function resolvePopularityScore(value: number | null | undefined): number {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return NEUTRAL;
    }
    return clampScore0to100(Number(value));
}

export function resolveManualBoost(value: number | null | undefined): number {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return 0;
    }
    const n = Math.trunc(Number(value));
    if (n < -10) return -10;
    if (n > 10) return 10;
    return n;
}

export function assertWeightsSumToOne(weights: TourismRankingWeights): boolean {
    const sum =
        weights.editorialWeight +
        weights.importanceWeight +
        weights.reviewWeight +
        weights.popularityWeight;
    return Math.abs(sum - 1) < WEIGHT_SUM_EPSILON;
}

export function requireValidTourismRankingWeights(
    weights: TourismRankingWeights,
    context = "tourism ranking weights"
): TourismRankingWeights {
    if (!assertWeightsSumToOne(weights)) {
        throw new Error(`${context} must sum to 1.0`);
    }
    for (const key of [
        "editorialWeight",
        "importanceWeight",
        "reviewWeight",
        "popularityWeight",
    ] as const) {
        if (!Number.isFinite(weights[key]) || weights[key] < 0) {
            throw new Error(`${context}: ${key} must be a non-negative finite number`);
        }
    }
    return weights;
}

/**
 * Inclusive month range; supports wrap (e.g. Nov–Feb → 11..12 and 1..2).
 */
export function isMonthInSeasonRange(
    month: number,
    startMonth: number,
    endMonth: number
): boolean {
    if (startMonth <= endMonth) {
        return month >= startMonth && month <= endMonth;
    }
    return month >= startMonth || month <= endMonth;
}

/**
 * Season modifier for Tourism Ranking V1.
 * Returns null when the place must be excluded (temporarily_closed).
 */
export function computeSeasonModifier(input: {
    seasonMode: TourismSeasonMode;
    seasonStartMonth: number | null | undefined;
    seasonEndMonth: number | null | undefined;
    referenceMonth: number;
}): number | null {
    if (input.seasonMode === "temporarily_closed") {
        return null;
    }
    if (input.seasonMode === "all_year") {
        return 1.0;
    }

    const start = input.seasonStartMonth;
    const end = input.seasonEndMonth;
    const hasRange =
        typeof start === "number" &&
        typeof end === "number" &&
        start >= 1 &&
        start <= 12 &&
        end >= 1 &&
        end <= 12;

    if (!hasRange) {
        return 1.0;
    }

    const inRange = isMonthInSeasonRange(input.referenceMonth, start, end);
    if (input.seasonMode === "best_months") {
        return inRange ? 1.05 : 1.0;
    }
    // poor_months
    return inRange ? 0.9 : 1.0;
}

export function computeTourismGeoBaseScore(input: {
    editorialScore: number;
    importanceScore: number;
    reviewScore: number;
    popularityScore: number;
    weights: TourismRankingWeights;
}): number {
    return (
        input.editorialScore * input.weights.editorialWeight +
        input.importanceScore * input.weights.importanceWeight +
        input.reviewScore * input.weights.reviewWeight +
        input.popularityScore * input.weights.popularityWeight
    );
}

export function computeTourismGeoFinalScore(input: {
    baseScore: number;
    seasonModifier: number;
    manualBoost: number;
}): { seasonAdjustedScore: number; finalScore: number } {
    const seasonAdjustedScore = input.baseScore * input.seasonModifier;
    return {
        seasonAdjustedScore,
        finalScore: clampScore0to100(seasonAdjustedScore + input.manualBoost),
    };
}

function emptyExcludedBreakdown(
    scope: TourismGeoRankingScope,
    weights: TourismRankingWeights,
    partial: {
        editorialScore: number;
        importanceScore: number;
        reviewScore: number;
        popularityScore: number;
        seasonMode: TourismSeasonMode;
        manualBoost: number;
    }
): TourismGeoRankingBreakdown {
    return {
        algorithmVersion: TOURISM_GEO_RANKING_ALGORITHM_VERSION,
        scope,
        editorialScore: partial.editorialScore,
        editorialWeight: weights.editorialWeight,
        editorialContribution: 0,
        importanceScore: partial.importanceScore,
        importanceWeight: weights.importanceWeight,
        importanceContribution: 0,
        reviewScore: partial.reviewScore,
        reviewWeight: weights.reviewWeight,
        reviewContribution: 0,
        popularityScore: partial.popularityScore,
        popularityWeight: weights.popularityWeight,
        popularityContribution: 0,
        seasonMode: partial.seasonMode,
        seasonModifier: 0,
        manualBoost: partial.manualBoost,
        baseScore: 0,
        seasonAdjustedScore: 0,
        finalScore: 0,
        excluded: true,
    };
}

/**
 * Full V1 score breakdown for one place in one independent scope.
 * Excluded places (temporarily_closed) return excluded=true and finalScore=0.
 */
export function computeTourismGeoRankingBreakdown(
    input: TourismGeoRankingInputs,
    weights: TourismRankingWeights,
    scope: TourismGeoRankingScope
): TourismGeoRankingBreakdown {
    const validWeights = requireValidTourismRankingWeights(weights);
    const editorialScore = resolveEditorialScore(input.editorialScore);
    const importanceScore = normalizeImportanceScore(input.importanceScore);
    const reviewScore = computeReviewScore(
        input.averageRating ?? null,
        Math.max(0, input.publishedReviewCount ?? 0)
    );
    const popularityScore = resolvePopularityScore(input.popularityScore);
    const manualBoost = resolveManualBoost(input.manualBoost);
    const referenceMonth =
        input.referenceMonth && input.referenceMonth >= 1 && input.referenceMonth <= 12
            ? input.referenceMonth
            : new Date().getUTCMonth() + 1;

    const seasonModifier = computeSeasonModifier({
        seasonMode: input.seasonMode,
        seasonStartMonth: input.seasonStartMonth,
        seasonEndMonth: input.seasonEndMonth,
        referenceMonth,
    });

    if (seasonModifier === null) {
        return emptyExcludedBreakdown(scope, validWeights, {
            editorialScore,
            importanceScore,
            reviewScore,
            popularityScore,
            seasonMode: input.seasonMode,
            manualBoost,
        });
    }

    const editorialContribution = editorialScore * validWeights.editorialWeight;
    const importanceContribution = importanceScore * validWeights.importanceWeight;
    const reviewContribution = reviewScore * validWeights.reviewWeight;
    const popularityContribution = popularityScore * validWeights.popularityWeight;
    const baseScore =
        editorialContribution +
        importanceContribution +
        reviewContribution +
        popularityContribution;
    const { seasonAdjustedScore, finalScore } = computeTourismGeoFinalScore({
        baseScore,
        seasonModifier,
        manualBoost,
    });

    return {
        algorithmVersion: TOURISM_GEO_RANKING_ALGORITHM_VERSION,
        scope,
        editorialScore,
        editorialWeight: validWeights.editorialWeight,
        editorialContribution,
        importanceScore,
        importanceWeight: validWeights.importanceWeight,
        importanceContribution,
        reviewScore,
        reviewWeight: validWeights.reviewWeight,
        reviewContribution,
        popularityScore,
        popularityWeight: validWeights.popularityWeight,
        popularityContribution,
        seasonMode: input.seasonMode,
        seasonModifier,
        manualBoost,
        baseScore,
        seasonAdjustedScore,
        finalScore,
        excluded: false,
    };
}

/**
 * Ranking preview for one place using canonical V1 weights for the scope.
 * Identical math to list ranking / admin breakdown.
 */
export function previewTourismGeoRankingScore(
    input: TourismGeoRankingInputs,
    scope: TourismGeoRankingScope,
    weights: TourismRankingWeights = TOURISM_GEO_RANKING_V1_WEIGHTS[scope]
): TourismGeoRankingBreakdown {
    return computeTourismGeoRankingBreakdown(input, weights, scope);
}

export type TourismGeoRankSortable = {
    readonly finalScore: number;
    readonly importanceScore: number;
    readonly editorialScore: number;
    readonly placeId: bigint | string | number;
};

/**
 * Sort: finalScore DESC, importance DESC, editorial DESC, place ID ASC.
 * Returns a new array; assign 1-based ranks after sorting.
 * Uses full-precision scores (never display-rounded values).
 */
export function sortTourismGeoRankingRows<T extends TourismGeoRankSortable>(
    rows: readonly T[]
): T[] {
    return [...rows].sort((a, b) => {
        if (a.finalScore !== b.finalScore) return b.finalScore - a.finalScore;
        if (a.importanceScore !== b.importanceScore) {
            return b.importanceScore - a.importanceScore;
        }
        if (a.editorialScore !== b.editorialScore) {
            return b.editorialScore - a.editorialScore;
        }
        const aId = String(a.placeId);
        const bId = String(b.placeId);
        return aId < bId ? -1 : aId > bId ? 1 : 0;
    });
}

/** Serialize a breakdown for API display (2-decimal rounding). Rank is optional. */
export function toTourismGeoRankingBreakdownDto(
    breakdown: TourismGeoRankingBreakdown,
    rank?: number
): {
    algorithm_version: string;
    scope: TourismGeoRankingScope;
    editorial_score: number;
    editorial_weight: number;
    editorial_contribution: number;
    importance_score: number;
    importance_weight: number;
    importance_contribution: number;
    review_score: number;
    review_weight: number;
    review_contribution: number;
    popularity_score: number;
    popularity_weight: number;
    popularity_contribution: number;
    season_modifier: number;
    manual_boost: number;
    base_score: number;
    season_adjusted_score: number;
    final_score: number;
    rank?: number;
} {
    return {
        algorithm_version: breakdown.algorithmVersion,
        scope: breakdown.scope,
        editorial_score: roundTourismScoreForDisplay(breakdown.editorialScore),
        editorial_weight: breakdown.editorialWeight,
        editorial_contribution: roundTourismScoreForDisplay(breakdown.editorialContribution),
        importance_score: roundTourismScoreForDisplay(breakdown.importanceScore),
        importance_weight: breakdown.importanceWeight,
        importance_contribution: roundTourismScoreForDisplay(breakdown.importanceContribution),
        review_score: roundTourismScoreForDisplay(breakdown.reviewScore),
        review_weight: breakdown.reviewWeight,
        review_contribution: roundTourismScoreForDisplay(breakdown.reviewContribution),
        popularity_score: roundTourismScoreForDisplay(breakdown.popularityScore),
        popularity_weight: breakdown.popularityWeight,
        popularity_contribution: roundTourismScoreForDisplay(breakdown.popularityContribution),
        season_modifier: roundTourismScoreForDisplay(breakdown.seasonModifier),
        manual_boost: breakdown.manualBoost,
        base_score: roundTourismScoreForDisplay(breakdown.baseScore),
        season_adjusted_score: roundTourismScoreForDisplay(breakdown.seasonAdjustedScore),
        final_score: roundTourismScoreForDisplay(breakdown.finalScore),
        ...(rank === undefined ? {} : { rank }),
    };
}
