import { authJson, publicGet } from '@/features/auth/api/http';
import type {
  CreatePlaceReviewBody,
  PlaceReviewOwner,
  PlaceReviewPage,
  UpdatePlaceReviewBody,
} from './placeReviewsApiTypes';

export type {
  CreatePlaceReviewBody,
  PlaceReviewAuthor,
  PlaceReviewOwner,
  PlaceReviewPage,
  PlaceReviewPublic,
  PlaceReviewStatus,
  UpdatePlaceReviewBody,
} from './placeReviewsApiTypes';

export {
  PLACE_REVIEW_BODY_MAX_LENGTH,
  PLACE_REVIEW_PAGE_SIZE,
  PLACE_REVIEW_RATING_MAX,
  PLACE_REVIEW_RATING_MIN,
  PLACE_REVIEW_TITLE_MAX_LENGTH,
} from './placeReviewsApiTypes';

export async function listPublishedPlaceReviews(
  placePublicId: string,
  options: {
    readonly cursor?: string;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  } = {},
): Promise<PlaceReviewPage> {
  const params = new URLSearchParams();
  if (options.cursor) params.set('cursor', options.cursor);
  if (typeof options.limit === 'number') params.set('limit', String(options.limit));
  const qs = params.toString();
  return publicGet<PlaceReviewPage>(
    `/places/${encodeURIComponent(placePublicId)}/reviews${qs ? `?${qs}` : ''}`,
    options.signal,
  );
}

export async function getMyPlaceReview(
  placePublicId: string,
  signal?: AbortSignal,
): Promise<PlaceReviewOwner | null> {
  return authJson<PlaceReviewOwner | null>(
    `/places/${encodeURIComponent(placePublicId)}/my-review`,
    { method: 'GET', signal },
  );
}

export async function createPlaceReview(
  placePublicId: string,
  body: CreatePlaceReviewBody,
): Promise<PlaceReviewOwner> {
  return authJson<PlaceReviewOwner>(
    `/places/${encodeURIComponent(placePublicId)}/reviews`,
    { method: 'POST', body },
  );
}

export async function updatePlaceReview(
  reviewPublicId: string,
  body: UpdatePlaceReviewBody,
): Promise<PlaceReviewOwner> {
  return authJson<PlaceReviewOwner>(
    `/reviews/${encodeURIComponent(reviewPublicId)}`,
    { method: 'PATCH', body },
  );
}

export async function deletePlaceReview(
  reviewPublicId: string,
): Promise<PlaceReviewOwner> {
  return authJson<PlaceReviewOwner>(
    `/reviews/${encodeURIComponent(reviewPublicId)}`,
    { method: 'DELETE' },
  );
}
