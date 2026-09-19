/**
 * Food & Drink township recommendations API client.
 * Separate from Tourism Discover.
 */
import { publicGet } from '@/features/auth/api/http';

export type FoodDrinkRankedPlace = {
  readonly rank: number;
  readonly public_id: string;
  readonly name: string;
  readonly name_mm: string | null;
  readonly name_en: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly category_code: string;
  readonly category_name: string;
  readonly category_name_mm: string | null;
  readonly average_rating: number | null;
  readonly published_review_count: number;
  readonly distance_meters: number | null;
};

export type FoodDrinkRecommendationsPage = {
  readonly ranking_group: 'food_drink';
  readonly scope: 'township';
  readonly algorithm_version: string;
  readonly township_admin_area_id: string;
  readonly township_name: string | null;
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly items: readonly FoodDrinkRankedPlace[];
};

export async function listFoodDrinkRecommendations(
  query: {
    readonly township_admin_area_id: string;
    readonly lang?: 'my' | 'en';
    readonly limit?: number;
    readonly offset?: number;
    readonly lat?: number;
    readonly lng?: number;
  },
  signal?: AbortSignal,
): Promise<FoodDrinkRecommendationsPage> {
  const params = new URLSearchParams();
  params.set('township_admin_area_id', query.township_admin_area_id);
  if (query.lang) params.set('lang', query.lang);
  if (typeof query.limit === 'number') params.set('limit', String(query.limit));
  if (typeof query.offset === 'number') params.set('offset', String(query.offset));
  if (typeof query.lat === 'number') params.set('lat', String(query.lat));
  if (typeof query.lng === 'number') params.set('lng', String(query.lng));
  return publicGet<FoodDrinkRecommendationsPage>(
    `/food-drink/recommendations?${params.toString()}`,
    signal,
  );
}
