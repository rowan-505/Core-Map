/**
 * Place popularity V1 weights and cold-start threshold.
 *
 * rawActivity30d =
 *   views * 1 + saves * 4 + shares * 4 + directions * 6
 *
 * Cold start: if the comparison population's total weighted points
 * are below PLACE_POPULARITY_COLD_START_TOTAL_WEIGHTED, every place
 * in that scope gets popularityScore = 50.
 */

export const PLACE_ACTIVITY_WEIGHTS = {
    view: 1,
    save: 4,
    share: 4,
    directions: 6,
} as const;

/** Rolling window used for raw activity aggregation. */
export const PLACE_ACTIVITY_WINDOW_DAYS = 30;

/**
 * When the sum of rawActivity30d across the comparison population is
 * strictly less than this value, return neutral popularity (50) for all.
 */
export const PLACE_POPULARITY_COLD_START_TOTAL_WEIGHTED = 20;

export const PLACE_POPULARITY_NEUTRAL_SCORE = 50;

export type PlaceActivityCounts = {
    readonly views: number;
    readonly saves: number;
    readonly shares: number;
    readonly directions: number;
};

export type PlacePopularityContextKind =
    | "tourism_township"
    | "tourism_region"
    | "tourism_national"
    | "food_drink_township";

export function computeRawActivity30d(counts: PlaceActivityCounts): number {
    return (
        Math.max(0, counts.views) * PLACE_ACTIVITY_WEIGHTS.view +
        Math.max(0, counts.saves) * PLACE_ACTIVITY_WEIGHTS.save +
        Math.max(0, counts.shares) * PLACE_ACTIVITY_WEIGHTS.share +
        Math.max(0, counts.directions) * PLACE_ACTIVITY_WEIGHTS.directions
    );
}
