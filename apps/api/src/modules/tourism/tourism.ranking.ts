/**
 * Tourism ranking helpers.
 * Bayesian score is computed at query time only — never stored on summaries.
 *
 * bayesian_score =
 *   (v / (v + m)) * R +
 *   (m / (v + m)) * C
 *
 * R = place average rating (published reviews)
 * v = published review count
 * C = global average across all published reviews
 * m = prior weight (5)
 */

export const TOURISM_RANKING_MODES = [
    "recommended",
    "top_rated",
    "most_reviewed",
    "nearby",
    "editor_picks",
] as const;

export type TourismRankingMode = (typeof TOURISM_RANKING_MODES)[number];

/** Prior weight m in the Bayesian average. */
export const TOURISM_BAYESIAN_PRIOR_WEIGHT = 5;

/** top_rated requires at least this many published reviews. */
export const TOURISM_TOP_RATED_MIN_REVIEWS = 5;

export const TOURISM_NEARBY_DEFAULT_RADIUS_M = 5_000;
export const TOURISM_NEARBY_MAX_RADIUS_M = 50_000;

export type TourismBayesianInputs = {
    placeAverageRating: number | null;
    publishedReviewCount: number;
    globalAverageRating: number | null;
    globalPublishedReviewCount: number;
    priorWeight?: number;
};

/**
 * Query-time Bayesian score. Returns null when there is no global published
 * average (zero published reviews worldwide) or the place has no published reviews.
 */
export function computeTourismBayesianScore(input: TourismBayesianInputs): number | null {
    const m = input.priorWeight ?? TOURISM_BAYESIAN_PRIOR_WEIGHT;
    const v = input.publishedReviewCount;
    const R = input.placeAverageRating;
    const C = input.globalAverageRating;

    if (input.globalPublishedReviewCount <= 0 || C === null || !Number.isFinite(C)) {
        return null;
    }
    if (v <= 0 || R === null || !Number.isFinite(R)) {
        return null;
    }

    return (v / (v + m)) * R + (m / (v + m)) * C;
}

export type TourismRankSortKey = {
    bayesianScore: number | null;
    publishedReviewCount: number;
    isVerified: boolean;
    /** Meters; only meaningful for nearby mode. */
    distanceMeters: number | null;
    /** Stable public UUID for final tie-break. */
    publicId: string;
};

/**
 * Compare two ranked rows for a mode.
 * Returns negative when `a` should sort before `b` (descending quality / ascending distance).
 */
export function compareTourismRankSortKeys(
    mode: TourismRankingMode,
    a: TourismRankSortKey,
    b: TourismRankSortKey
): number {
    if (mode === "nearby") {
        const da = a.distanceMeters ?? Number.POSITIVE_INFINITY;
        const db = b.distanceMeters ?? Number.POSITIVE_INFINITY;
        if (da !== db) return da < db ? -1 : 1;
        return a.publicId < b.publicId ? -1 : a.publicId > b.publicId ? 1 : 0;
    }

    if (mode === "most_reviewed") {
        if (a.publishedReviewCount !== b.publishedReviewCount) {
            return b.publishedReviewCount - a.publishedReviewCount;
        }
        if (a.isVerified !== b.isVerified) {
            return a.isVerified ? -1 : 1;
        }
        return a.publicId < b.publicId ? -1 : a.publicId > b.publicId ? 1 : 0;
    }

    // recommended | top_rated | editor_picks
    // When scores are null (no global reviews), use deterministic fallback.
    const scoreA = a.bayesianScore;
    const scoreB = b.bayesianScore;
    if (scoreA !== null && scoreB !== null && scoreA !== scoreB) {
        return scoreB > scoreA ? 1 : -1;
    }
    if (scoreA !== null && scoreB === null) return -1;
    if (scoreA === null && scoreB !== null) return 1;

    if (a.publishedReviewCount !== b.publishedReviewCount) {
        return b.publishedReviewCount - a.publishedReviewCount;
    }
    if (a.isVerified !== b.isVerified) {
        return a.isVerified ? -1 : 1;
    }
    return a.publicId < b.publicId ? -1 : a.publicId > b.publicId ? 1 : 0;
}

export function isTourismRankingMode(value: string): value is TourismRankingMode {
    return (TOURISM_RANKING_MODES as readonly string[]).includes(value);
}
