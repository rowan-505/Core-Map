import { TourismReviewsService } from "../tourism/tourism.service.js";
import type { PlaceReviewsRepository } from "./place-reviews.repo.js";
import { computeReviewScore } from "./place-reviews.scoring.js";

export { PlaceReviewsError } from "./place-reviews.errors.js";
export { resolvePlaceReviewAdminTransition } from "./place-reviews.moderation.js";

export type PlaceRatingSummaryDto = {
    place_public_id: string;
    published_review_count: number;
    average_rating: number | null;
    review_score: number;
    updated_at: string;
};

/**
 * Universal place-review service. Existing review behavior is inherited from
 * the production tourism implementation during the Phase 1 split.
 */
export class PlaceReviewsService extends TourismReviewsService {
    constructor(repo: PlaceReviewsRepository) {
        super(repo);
    }

    override async refreshRatingSummary(placePublicId: string): Promise<PlaceRatingSummaryDto> {
        const summary = await super.refreshRatingSummary(placePublicId);
        return {
            ...summary,
            review_score: computeReviewScore(
                summary.average_rating,
                summary.published_review_count
            ),
        };
    }
}

export type {
    TourismAdminReviewDetailDto as PlaceAdminReviewDetailDto,
    TourismAdminReviewPageDto as PlaceAdminReviewPageDto,
    TourismModerationEventDto as PlaceReviewModerationEventDto,
    TourismReviewAuthorDto as PlaceReviewAuthorDto,
    TourismReviewOwnerDto as PlaceReviewOwnerDto,
    TourismReviewPageDto as PlaceReviewPageDto,
    TourismReviewPublicDto as PlaceReviewPublicDto,
} from "../tourism/tourism.service.js";
