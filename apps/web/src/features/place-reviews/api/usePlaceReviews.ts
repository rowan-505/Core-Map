import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  getMyPlaceReview,
  listPublishedPlaceReviews,
} from './placeReviewsApi';
import { PLACE_REVIEW_PAGE_SIZE } from './placeReviewsApiTypes';

export const publishedPlaceReviewsQueryKey = (
  publicId: string,
  limit: number,
) => ['place-reviews', 'published', publicId, limit] as const;

export const myPlaceReviewQueryKey = (publicId: string) =>
  ['place-reviews', 'my-review', publicId] as const;

export function usePublishedPlaceReviews(options: {
  readonly placePublicId: string | null;
  readonly enabled?: boolean;
  readonly limit?: number;
}) {
  const limit = options.limit ?? PLACE_REVIEW_PAGE_SIZE;
  return useInfiniteQuery({
    queryKey: publishedPlaceReviewsQueryKey(options.placePublicId ?? '', limit),
    enabled: Boolean(options.placePublicId) && (options.enabled ?? true),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listPublishedPlaceReviews(options.placePublicId!, {
        cursor: pageParam,
        limit,
        signal,
      }),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useMyPlaceReview(options: {
  readonly placePublicId: string | null;
  readonly enabled?: boolean;
}) {
  return useQuery({
    queryKey: myPlaceReviewQueryKey(options.placePublicId ?? ''),
    enabled: Boolean(options.placePublicId) && (options.enabled ?? true),
    queryFn: ({ signal }) => getMyPlaceReview(options.placePublicId!, signal),
  });
}
