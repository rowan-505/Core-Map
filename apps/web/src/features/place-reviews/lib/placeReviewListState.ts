import type { PlaceReviewPublic } from '../api/placeReviewsApiTypes';

export type PlaceReviewsUiState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ready';
      readonly items: readonly PlaceReviewPublic[];
      readonly hasMore: boolean;
      readonly loadingMore: boolean;
    };

export function resolvePlaceReviewsUiState(input: {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly errorMessage: string;
  readonly items: readonly PlaceReviewPublic[];
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
}): PlaceReviewsUiState {
  if (input.isLoading && input.items.length === 0) return { kind: 'loading' };
  if (input.isError && input.items.length === 0) {
    return { kind: 'error', message: input.errorMessage };
  }
  if (input.items.length === 0) return { kind: 'empty' };
  return {
    kind: 'ready',
    items: input.items,
    hasMore: input.hasMore,
    loadingMore: input.loadingMore,
  };
}

export function flattenPlaceReviewPages(
  pages: readonly { readonly items: readonly PlaceReviewPublic[] }[] | undefined,
): readonly PlaceReviewPublic[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const out: PlaceReviewPublic[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.public_id)) continue;
      seen.add(item.public_id);
      out.push(item);
    }
  }
  return out;
}

export function filterPublishedReviewsOnly(
  items: readonly PlaceReviewPublic[],
): readonly PlaceReviewPublic[] {
  return items.filter((item) => item.status === 'published');
}
