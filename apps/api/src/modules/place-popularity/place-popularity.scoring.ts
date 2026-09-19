import {
    computeRawActivity30d,
    PLACE_POPULARITY_COLD_START_TOTAL_WEIGHTED,
    PLACE_POPULARITY_NEUTRAL_SCORE,
    type PlaceActivityCounts,
} from "./place-popularity.weights.js";

export type PlaceRawActivity = {
    readonly placeId: bigint | string | number;
    readonly rawActivity30d: number;
};

export type PlacePopularityScore = {
    readonly placeId: string;
    readonly rawActivity30d: number;
    readonly popularityScore: number;
    readonly coldStart: boolean;
};

/**
 * Percent-rank style normalization within a supplied comparison population.
 *
 * For each place:
 *   popularityScore = round(100 * (count of peers with strictly lower raw) / (n - 1))
 *
 * Cold start: if sum(rawActivity30d) < PLACE_POPULARITY_COLD_START_TOTAL_WEIGHTED,
 * every place gets 50.
 *
 * Empty population returns []. Single-member or all-zero cold-start populations
 * still return neutral 50 when the threshold applies; a single active member
 * with enough total weight gets 100 (only peerless top of a non-cold population).
 */
export function normalizePopularityScores(
    population: readonly PlaceRawActivity[]
): PlacePopularityScore[] {
    if (population.length === 0) {
        return [];
    }

    const normalized = population.map((row) => ({
        placeId: String(row.placeId),
        rawActivity30d: Math.max(0, Number(row.rawActivity30d) || 0),
    }));

    const totalWeighted = normalized.reduce((sum, row) => sum + row.rawActivity30d, 0);
    if (totalWeighted < PLACE_POPULARITY_COLD_START_TOTAL_WEIGHTED) {
        return normalized.map((row) => ({
            ...row,
            popularityScore: PLACE_POPULARITY_NEUTRAL_SCORE,
            coldStart: true,
        }));
    }

    const n = normalized.length;
    if (n === 1) {
        return [
            {
                ...normalized[0]!,
                popularityScore: 100,
                coldStart: false,
            },
        ];
    }

    return normalized.map((row) => {
        let below = 0;
        for (const peer of normalized) {
            if (peer.rawActivity30d < row.rawActivity30d) {
                below += 1;
            }
        }
        const popularityScore = Math.round((100 * below) / (n - 1));
        return {
            ...row,
            popularityScore: clampScore(popularityScore),
            coldStart: false,
        };
    });
}

export function scoresFromActivityCounts(
    rows: readonly { placeId: bigint | string | number; counts: PlaceActivityCounts }[]
): PlacePopularityScore[] {
    return normalizePopularityScores(
        rows.map((row) => ({
            placeId: row.placeId,
            rawActivity30d: computeRawActivity30d(row.counts),
        }))
    );
}

function clampScore(score: number): number {
    if (score < 0) return 0;
    if (score > 100) return 100;
    return score;
}
