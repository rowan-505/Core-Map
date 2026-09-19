import { apiFetch } from "@/src/lib/api";

export type FoodDrinkAdminRankedPlace = {
  rank: number;
  public_id: string;
  name: string;
  name_mm: string | null;
  name_en: string | null;
  lat: number;
  lng: number;
  category_code: string;
  category_name: string;
  category_name_mm: string | null;
  average_rating: number | null;
  published_review_count: number;
  distance_meters: number | null;
  review_score: number;
  popularity_score: number;
  importance_score: number;
  food_score: number;
};

export type FoodDrinkRecommendationsPage = {
  ranking_group: "food_drink";
  scope: "township";
  algorithm_version: string;
  township_admin_area_id: string;
  township_name: string | null;
  total: number;
  limit: number;
  offset: number;
  items: FoodDrinkAdminRankedPlace[];
};

type Signal = { signal?: AbortSignal };

export function listAdminFoodDrinkRecommendations(
  filters: {
    township_admin_area_id: string;
    limit?: number;
    offset?: number;
  },
  init?: Signal
) {
  const params = new URLSearchParams();
  params.set("township_admin_area_id", filters.township_admin_area_id);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  if (filters.offset != null) params.set("offset", String(filters.offset));
  return apiFetch<FoodDrinkRecommendationsPage>(
    `/admin/food-drink/recommendations?${params.toString()}`,
    { method: "GET", ...init }
  );
}
