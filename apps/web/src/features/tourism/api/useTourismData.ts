import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  getTourismPlaceGeoRanks,
  getTourismPlaceProfile,
  listTourismActivities,
  listTourismEvents,
  listTourismGeoRanking,
  listTourismPlaces,
  type TourismGeoRankingScope,
  type TourismPlacesListQuery,
  type TourismRankingMode,
} from './tourismApi';
import { ApiError } from '@/features/auth/api/http';

export const tourismPlacesQueryKey = (
  query: Omit<TourismPlacesListQuery, 'cursor'>,
) =>
  [
    'tourism',
    'places',
    query.mode,
    query.tourism_type ?? null,
    query.lang ?? null,
    query.lat ?? null,
    query.lng ?? null,
    query.radius_m ?? null,
    query.bbox ?? null,
    query.limit ?? 20,
  ] as const;

export const tourismPlaceProfileQueryKey = (
  publicId: string,
  lang?: 'my' | 'en',
) => ['tourism', 'profile', publicId, lang ?? null] as const;

export function useTourismPlaces(options: {
  readonly enabled: boolean;
  readonly mode: TourismRankingMode;
  readonly tourismType?: string | null;
  readonly lang?: 'my' | 'en';
  readonly lat?: number | null;
  readonly lng?: number | null;
  readonly radiusM?: number;
  readonly bbox?: string | null;
  readonly limit?: number;
}) {
  const nearbyReady =
    options.mode !== 'nearby' ||
    (typeof options.lat === 'number' && typeof options.lng === 'number');

  const query: Omit<TourismPlacesListQuery, 'cursor'> = {
    mode: options.mode,
    tourism_type: options.tourismType ?? undefined,
    lang: options.lang,
    lat: options.lat ?? undefined,
    lng: options.lng ?? undefined,
    radius_m: options.mode === 'nearby' ? (options.radiusM ?? 5000) : undefined,
    bbox: options.bbox ?? undefined,
    limit: options.limit ?? 20,
  };

  return useInfiniteQuery({
    queryKey: tourismPlacesQueryKey(query),
    enabled: options.enabled && nearbyReady,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listTourismPlaces(
        {
          ...query,
          cursor: pageParam,
        },
        signal,
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useTourismPlaceProfile(options: {
  readonly publicId: string | null;
  readonly lang?: 'my' | 'en';
  readonly enabled?: boolean;
}) {
  return useQuery({
    queryKey: tourismPlaceProfileQueryKey(options.publicId ?? '', options.lang),
    enabled: Boolean(options.publicId) && (options.enabled ?? true),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 1;
    },
    queryFn: ({ signal }) =>
      getTourismPlaceProfile(options.publicId!, {
        lang: options.lang,
        signal,
      }),
  });
}

export function isTourismProfileNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function useTourismGeoRanking(options: {
  readonly enabled: boolean;
  readonly scope: TourismGeoRankingScope;
  readonly tourismType?: string | null;
  readonly lang?: 'my' | 'en';
  readonly adminAreaId?: string | null;
  readonly limit?: number;
}) {
  return useInfiniteQuery({
    queryKey: [
      'tourism',
      'geo-ranking',
      options.scope,
      options.tourismType ?? null,
      options.lang ?? null,
      options.adminAreaId ?? null,
      options.limit ?? 20,
    ],
    enabled:
      options.enabled &&
      (options.scope === 'national' || Boolean(options.adminAreaId)),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      listTourismGeoRanking(
        {
          scope: options.scope,
          admin_area_id: options.adminAreaId ?? undefined,
          tourism_type: options.tourismType,
          lang: options.lang,
          limit: options.limit ?? 20,
          offset: pageParam,
        },
        signal,
      ),
    getNextPageParam: (last) => {
      const next = last.offset + last.limit;
      return next < last.total ? next : undefined;
    },
  });
}

export function useTourismPlaceGeoRanks(options: {
  readonly publicId: string | null;
  readonly enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['tourism', 'geo-ranks', options.publicId ?? null],
    enabled: Boolean(options.publicId) && (options.enabled ?? true),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 1;
    },
    queryFn: ({ signal }) => getTourismPlaceGeoRanks(options.publicId!, signal),
  });
}

export function useTourismActivities(options: {
  readonly enabled?: boolean;
  readonly adminAreaId?: string | null;
  readonly limit?: number;
}) {
  return useQuery({
    queryKey: [
      'tourism',
      'activities',
      options.adminAreaId ?? null,
      options.limit ?? 12,
    ],
    enabled: options.enabled ?? true,
    queryFn: ({ signal }) =>
      listTourismActivities(
        {
          admin_area_id: options.adminAreaId ?? undefined,
          limit: options.limit ?? 12,
          offset: 0,
        },
        signal,
      ),
  });
}

export function useTourismEvents(options: {
  readonly status: 'happening_now' | 'upcoming';
  readonly enabled?: boolean;
  readonly adminAreaId?: string | null;
  readonly limit?: number;
}) {
  return useQuery({
    queryKey: [
      'tourism',
      'events',
      options.status,
      options.adminAreaId ?? null,
      options.limit ?? 12,
    ],
    enabled: options.enabled ?? true,
    queryFn: ({ signal }) =>
      listTourismEvents(
        {
          status: options.status,
          admin_area_id: options.adminAreaId ?? undefined,
          limit: options.limit ?? 12,
          offset: 0,
        },
        signal,
      ),
  });
}
