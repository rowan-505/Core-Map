const NEUTRAL_REVIEW_SCORE = 50;
const FULL_CONFIDENCE_REVIEW_COUNT = 20;

/**
 * Convert a 1–5 average rating into a confidence-adjusted 0–100 score.
 * The score stays neutral when there are no published reviews.
 */
export function computeReviewScore(
    averageRating: number | null,
    publishedReviewCount: number
): number {
    if (publishedReviewCount <= 0 || averageRating === null) {
        return NEUTRAL_REVIEW_SCORE;
    }

    const rawReviewScore = averageRating * 20;
    const reviewConfidence = Math.min(publishedReviewCount / FULL_CONFIDENCE_REVIEW_COUNT, 1);
    return NEUTRAL_REVIEW_SCORE + (rawReviewScore - NEUTRAL_REVIEW_SCORE) * reviewConfidence;
}
