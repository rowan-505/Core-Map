import type { TourismRankedPlace, TourismRankingMode } from '../api/tourismApiTypes';

export type TourismListUiState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ready';
      readonly items: readonly TourismRankedPlace[];
      readonly hasMore: boolean;
      readonly loadingMore: boolean;
    };

export function resolveTourismListUiState(input: {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly errorMessage: string;
  readonly items: readonly TourismRankedPlace[];
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
}): TourismListUiState {
  if (input.isLoading && input.items.length === 0) {
    return { kind: 'loading' };
  }
  if (input.isError && input.items.length === 0) {
    return { kind: 'error', message: input.errorMessage };
  }
  if (input.items.length === 0) {
    return { kind: 'empty' };
  }
  return {
    kind: 'ready',
    items: input.items,
    hasMore: input.hasMore,
    loadingMore: input.loadingMore,
  };
}

export function flattenTourismPages(
  pages: readonly { readonly items: readonly TourismRankedPlace[] }[] | undefined,
): readonly TourismRankedPlace[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const out: TourismRankedPlace[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.public_id)) continue;
      seen.add(item.public_id);
      out.push(item);
    }
  }
  return out;
}

/** Mobile-friendly card class contract (touch targets + readable density). */
export const TOURISM_PLACE_CARD_CLASS =
  'w-full min-h-16 rounded-map-card border p-3 text-left shadow-map-card transition-[color,background-color,border-color,box-shadow] duration-150';

export function tourismModeNeedsMapCenter(mode: TourismRankingMode): boolean {
  return mode === 'nearby';
}
