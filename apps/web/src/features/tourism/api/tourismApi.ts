/**
 * Tourism API client for the public web map.
 * Uses tourism Fastify routes only — no Supabase, no tile payloads.
 */
import { publicGet } from '@/features/auth/api/http';
import { buildTourismPlacesQuery } from '../lib/buildTourismPlacesQuery';
import type {
  TourismPlaceProfile,
  TourismPlacesListQuery,
  TourismRankedPlacePage,
} from './tourismApiTypes';

export type {
  TourismPlaceProfile,
  TourismPlacesListQuery,
  TourismRankedPlace,
  TourismRankedPlacePage,
  TourismRankingMode,
} from './tourismApiTypes';

export { buildTourismPlacesQuery };

export async function listTourismPlaces(
  query: TourismPlacesListQuery,
  signal?: AbortSignal,
): Promise<TourismRankedPlacePage> {
  return publicGet<TourismRankedPlacePage>(
    `/tourism/places${buildTourismPlacesQuery(query)}`,
    signal,
  );
}

export async function getTourismPlaceProfile(
  placePublicId: string,
  options: { readonly lang?: 'my' | 'en'; readonly signal?: AbortSignal } = {},
): Promise<TourismPlaceProfile> {
  const params = new URLSearchParams();
  if (options.lang) params.set('lang', options.lang);
  const qs = params.toString();
  return publicGet<TourismPlaceProfile>(
    `/tourism/places/${encodeURIComponent(placePublicId)}${qs ? `?${qs}` : ''}`,
    options.signal,
  );
}

export type TourismGeoRankingScope = 'township' | 'region' | 'national';

export type TourismGeoRankedPlace = {
  readonly rank: number;
  readonly public_id: string;
  readonly name: string;
  readonly name_mm: string | null;
  readonly name_en: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly tourism_type: string;
  readonly tourism_type_name_en: string;
  readonly tourism_type_name_mm: string | null;
  readonly short_description: string | null;
  readonly price_level: number | null;
  readonly editor_pick: boolean;
  readonly average_rating: number | null;
  readonly published_review_count: number;
  readonly season_mode: string;
};

export type TourismGeoRankingPage = {
  readonly scope: TourismGeoRankingScope;
  readonly algorithm_version: string;
  readonly admin_area_id: string | null;
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly items: readonly TourismGeoRankedPlace[];
};

export type TourismPlaceGeoRanks = {
  readonly public_id: string;
  readonly township: { rank: number; total: number; admin_area_id: string } | null;
  readonly region: { rank: number; total: number; admin_area_id: string } | null;
  readonly national: { rank: number; total: number } | null;
};

export async function listTourismGeoRanking(
  query: {
    readonly scope: TourismGeoRankingScope;
    readonly admin_area_id?: string;
    readonly tourism_type?: string | null;
    readonly lang?: 'my' | 'en';
    readonly limit?: number;
    readonly offset?: number;
  },
  signal?: AbortSignal,
): Promise<TourismGeoRankingPage> {
  const params = new URLSearchParams();
  params.set('scope', query.scope);
  if (query.admin_area_id) params.set('admin_area_id', query.admin_area_id);
  if (query.tourism_type) params.set('tourism_type', query.tourism_type);
  if (query.lang) params.set('lang', query.lang);
  if (typeof query.limit === 'number') params.set('limit', String(query.limit));
  if (typeof query.offset === 'number') params.set('offset', String(query.offset));
  return publicGet<TourismGeoRankingPage>(`/tourism/ranking?${params.toString()}`, signal);
}

export async function getTourismPlaceGeoRanks(
  placePublicId: string,
  signal?: AbortSignal,
): Promise<TourismPlaceGeoRanks> {
  return publicGet<TourismPlaceGeoRanks>(
    `/tourism/places/${encodeURIComponent(placePublicId)}/geo-ranks`,
    signal,
  );
}

export type TourismPublicActivity = {
  readonly public_id: string;
  readonly name: string;
  readonly short_description: string | null;
  readonly activity_type: string;
  readonly activity_type_name_en: string;
  readonly admin_area_name: string;
  readonly is_verified: boolean;
  readonly season_mode: string;
  readonly season_start_month: number | null;
  readonly season_end_month: number | null;
  readonly display_priority: number;
  readonly primary_place: {
    readonly public_id: string;
    readonly name: string;
    readonly lat: number | null;
    readonly lng: number | null;
  } | null;
};

export type TourismPublicActivityPage = {
  readonly items: readonly TourismPublicActivity[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
};

export type TourismPublicEvent = {
  readonly public_id: string;
  readonly name: string;
  readonly short_description: string | null;
  readonly event_type: string;
  readonly event_type_name_en: string;
  readonly admin_area_name: string;
  readonly is_verified: boolean;
  readonly primary_place: {
    readonly public_id: string;
    readonly name: string;
    readonly lat: number | null;
    readonly lng: number | null;
  } | null;
  readonly occurrence: {
    readonly public_id: string;
    readonly starts_at: string;
    readonly ends_at: string;
    readonly status: string;
    readonly schedule_note: string | null;
    readonly derived_state: string;
    readonly duration_days: number;
  };
};

export type TourismPublicEventPage = {
  readonly status: 'happening_now' | 'upcoming';
  readonly items: readonly TourismPublicEvent[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
};

export async function listTourismActivities(
  query: {
    readonly admin_area_id?: string;
    readonly activity_type?: string;
    readonly limit?: number;
    readonly offset?: number;
  } = {},
  signal?: AbortSignal,
): Promise<TourismPublicActivityPage> {
  const params = new URLSearchParams();
  if (query.admin_area_id) params.set('admin_area_id', query.admin_area_id);
  if (query.activity_type) params.set('activity_type', query.activity_type);
  if (typeof query.limit === 'number') params.set('limit', String(query.limit));
  if (typeof query.offset === 'number') params.set('offset', String(query.offset));
  const qs = params.toString();
  return publicGet<TourismPublicActivityPage>(
    `/tourism/activities${qs ? `?${qs}` : ''}`,
    signal,
  );
}

export async function listTourismEvents(
  query: {
    readonly status: 'happening_now' | 'upcoming';
    readonly admin_area_id?: string;
    readonly event_type?: string;
    readonly limit?: number;
    readonly offset?: number;
  },
  signal?: AbortSignal,
): Promise<TourismPublicEventPage> {
  const params = new URLSearchParams();
  params.set('status', query.status);
  if (query.admin_area_id) params.set('admin_area_id', query.admin_area_id);
  if (query.event_type) params.set('event_type', query.event_type);
  if (typeof query.limit === 'number') params.set('limit', String(query.limit));
  if (typeof query.offset === 'number') params.set('offset', String(query.offset));
  return publicGet<TourismPublicEventPage>(`/tourism/events?${params.toString()}`, signal);
}
