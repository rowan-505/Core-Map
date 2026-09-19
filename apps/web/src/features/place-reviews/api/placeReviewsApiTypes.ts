export type PlaceReviewStatus =
  | 'pending'
  | 'published'
  | 'rejected'
  | 'hidden'
  | 'deleted';

export type PlaceReviewAuthor = {
  readonly public_id: string;
  readonly display_name: string;
};

export type PlaceReviewPublic = {
  readonly public_id: string;
  readonly place_public_id: string;
  readonly rating: number;
  readonly title: string | null;
  readonly body: string | null;
  readonly status: PlaceReviewStatus;
  readonly created_at: string;
  readonly updated_at: string;
  readonly published_at: string | null;
  readonly author: PlaceReviewAuthor;
};

export type PlaceReviewOwner = PlaceReviewPublic & {
  readonly moderation_note: string | null;
};

export type PlaceReviewPage = {
  readonly items: readonly PlaceReviewPublic[];
  readonly next_cursor: string | null;
};

export type CreatePlaceReviewBody = {
  readonly rating: number;
  readonly title?: string;
  readonly body?: string;
};

export type UpdatePlaceReviewBody = {
  readonly rating?: number;
  readonly title?: string | null;
  readonly body?: string | null;
};

export const PLACE_REVIEW_RATING_MIN = 1;
export const PLACE_REVIEW_RATING_MAX = 5;
export const PLACE_REVIEW_TITLE_MAX_LENGTH = 200;
export const PLACE_REVIEW_BODY_MAX_LENGTH = 5000;
export const PLACE_REVIEW_PAGE_SIZE = 20;
