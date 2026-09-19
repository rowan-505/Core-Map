import { apiFetch } from "@/src/lib/api";

import {
  buildAdminTourismReviewsPath,
  buildTourismPlacesRankingPath,
} from "./filters";
import type {
  TourismModerationAction,
  TourismPlaceProfileAdmin,
  TourismPlacesListFilters,
  TourismProfilePatchBody,
  TourismProfileUpsertBody,
  TourismRankedPlacePage,
  TourismReviewDetail,
  TourismReviewListFilters,
  TourismReviewPage,
  TourismTypePage,
} from "./types";

type Signal = Pick<RequestInit, "signal">;

export function listAdminTourismReviews(
  filters: TourismReviewListFilters,
  init?: Signal,
) {
  return apiFetch<TourismReviewPage>(buildAdminTourismReviewsPath(filters), {
    method: "GET",
    ...init,
  });
}

export function getAdminTourismReview(publicId: string, init?: Signal) {
  return apiFetch<TourismReviewDetail>(
    `/admin/reviews/${encodeURIComponent(publicId)}`,
    { method: "GET", ...init },
  );
}

export function moderateTourismReview(
  publicId: string,
  action: TourismModerationAction,
  note?: string,
) {
  return apiFetch<TourismReviewListItemLike>(
    `/admin/reviews/${encodeURIComponent(publicId)}/${encodeURIComponent(action)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(note ? { note } : {}),
    },
  );
}

type TourismReviewListItemLike = {
  readonly public_id: string;
  readonly status: string;
};

export function listTourismPlacesRanking(
  filters: TourismPlacesListFilters,
  init?: Signal,
) {
  return apiFetch<TourismRankedPlacePage>(buildTourismPlacesRankingPath(filters), {
    method: "GET",
    ...init,
  });
}

export function listTourismTypes(init?: Signal) {
  return apiFetch<TourismTypePage>("/tourism/types", {
    method: "GET",
    ...init,
  });
}

export function getTourismPlaceProfile(placePublicId: string, init?: Signal) {
  return apiFetch<TourismPlaceProfileAdmin>(
    `/admin/tourism/places/${encodeURIComponent(placePublicId)}/profile`,
    { method: "GET", ...init },
  );
}

export function createTourismPlaceProfile(
  placePublicId: string,
  body: TourismProfileUpsertBody,
) {
  return apiFetch<TourismPlaceProfileAdmin>(
    `/admin/tourism/places/${encodeURIComponent(placePublicId)}/profile`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function updateTourismPlaceProfile(
  placePublicId: string,
  body: TourismProfilePatchBody,
) {
  return apiFetch<TourismPlaceProfileAdmin>(
    `/admin/tourism/places/${encodeURIComponent(placePublicId)}/profile`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export type TourismGeoRankingScope = "township" | "region" | "national";

export type TourismGeoRankedPlaceAdmin = {
  readonly rank: number;
  readonly public_id: string;
  readonly name: string;
  readonly tourism_type: string;
  readonly tourism_type_name_en?: string;
  readonly township_name: string | null;
  readonly season_mode: string;
  readonly season_start_month: number | null;
  readonly season_end_month: number | null;
  readonly editor_pick: boolean;
  readonly average_rating: number | null;
  readonly published_review_count: number;
  readonly algorithm_version: string;
  readonly scope: TourismGeoRankingScope;
  readonly editorial_score: number;
  readonly editorial_weight: number;
  readonly editorial_contribution: number;
  readonly importance_score: number;
  readonly importance_weight: number;
  readonly importance_contribution: number;
  readonly review_score: number;
  readonly review_weight: number;
  readonly review_contribution: number;
  readonly popularity_score: number;
  readonly popularity_weight: number;
  readonly popularity_contribution: number;
  readonly season_modifier: number;
  readonly manual_boost: number;
  readonly base_score: number;
  readonly season_adjusted_score: number;
  readonly final_score: number;
};

export type TourismGeoRankingPage = {
  readonly scope: TourismGeoRankingScope;
  readonly algorithm_version: string;
  readonly admin_area_id: string | null;
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly items: readonly TourismGeoRankedPlaceAdmin[];
};

export function listAdminTourismGeoRanking(
  filters: {
    scope: TourismGeoRankingScope;
    admin_area_id?: string;
    tourism_type?: string;
    limit?: number;
    offset?: number;
  },
  init?: Signal,
) {
  const params = new URLSearchParams();
  params.set("scope", filters.scope);
  if (filters.admin_area_id) params.set("admin_area_id", filters.admin_area_id);
  if (filters.tourism_type) params.set("tourism_type", filters.tourism_type);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  if (filters.offset != null) params.set("offset", String(filters.offset));
  return apiFetch<TourismGeoRankingPage>(`/admin/tourism/ranking?${params.toString()}`, {
    method: "GET",
    ...init,
  });
}

export type TourismRankingPreviewSnapshot = {
  readonly rank: number | null;
  readonly final_score: number | null;
  readonly excluded: boolean;
  readonly algorithm_version: string;
  readonly scope: TourismGeoRankingScope;
  readonly editorial_score: number;
  readonly editorial_weight: number;
  readonly editorial_contribution: number;
  readonly importance_score: number;
  readonly importance_weight: number;
  readonly importance_contribution: number;
  readonly review_score: number;
  readonly review_weight: number;
  readonly review_contribution: number;
  readonly popularity_score: number;
  readonly popularity_weight: number;
  readonly popularity_contribution: number;
  readonly season_modifier: number;
  readonly manual_boost: number;
  readonly base_score: number;
  readonly season_adjusted_score: number;
};

export type TourismRankingPreviewResponse = {
  readonly algorithm_version: string;
  readonly scope: TourismGeoRankingScope;
  readonly admin_area_id: string | null;
  readonly place_public_id: string;
  readonly has_changes: boolean;
  readonly current: TourismRankingPreviewSnapshot;
  readonly preview: TourismRankingPreviewSnapshot;
};

export function previewAdminTourismRanking(
  body: {
    place_public_id: string;
    scope: TourismGeoRankingScope;
    admin_area_id?: string;
    reference_month?: number;
    proposed?: {
      editorial_score?: number;
      season_mode?: string;
      season_start_month?: number | null;
      season_end_month?: number | null;
      manual_boost?: number;
    };
  },
  init?: Signal,
) {
  return apiFetch<TourismRankingPreviewResponse>("/admin/tourism/ranking/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
}

export type TourismCandidateItem = {
  readonly public_id: string;
  readonly name: string;
  readonly name_mm: string | null;
  readonly name_en: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly category_code: string | null;
  readonly category_name: string | null;
  readonly category_name_mm: string | null;
  readonly importance_score: number | null;
  readonly is_verified: boolean;
  readonly township_admin_area_id: string | null;
  readonly township_name: string | null;
  readonly region_name: string | null;
  readonly suggested_tourism_type: string;
  readonly source_signals: {
    readonly osm_tourism: string | null;
    readonly osm_historic: string | null;
    readonly osm_leisure: string | null;
    readonly osm_natural: string | null;
  };
};

export type TourismCandidatesPage = {
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly items: readonly TourismCandidateItem[];
};

export type TourismCandidatesOverviewItem = {
  readonly township_admin_area_id: string;
  readonly township_name: string;
  readonly region_admin_area_id: string | null;
  readonly candidate_count: number;
  readonly approved_tourism_profiles: number;
  readonly active_public_profiles: number;
  readonly verified_profiles: number;
  readonly coverage_status: "none" | "open" | "strong" | "covered";
};

export type TourismCandidatesOverviewPage = {
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly items: readonly TourismCandidatesOverviewItem[];
};

export function listAdminTourismCandidates(
  filters: {
    region_admin_area_id?: string;
    township_admin_area_id?: string;
    category_code?: string;
    q?: string;
    limit?: number;
    offset?: number;
  },
  init?: Signal,
) {
  const params = new URLSearchParams();
  if (filters.region_admin_area_id) {
    params.set("region_admin_area_id", filters.region_admin_area_id);
  }
  if (filters.township_admin_area_id) {
    params.set("township_admin_area_id", filters.township_admin_area_id);
  }
  if (filters.category_code) params.set("category_code", filters.category_code);
  if (filters.q) params.set("q", filters.q);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  if (filters.offset != null) params.set("offset", String(filters.offset));
  return apiFetch<TourismCandidatesPage>(
    `/admin/tourism/candidates?${params.toString()}`,
    { method: "GET", ...init },
  );
}

export function listAdminTourismCandidatesOverview(
  filters: {
    region_admin_area_id?: string;
    limit?: number;
    offset?: number;
  } = {},
  init?: Signal,
) {
  const params = new URLSearchParams();
  if (filters.region_admin_area_id) {
    params.set("region_admin_area_id", filters.region_admin_area_id);
  }
  if (filters.limit != null) params.set("limit", String(filters.limit));
  if (filters.offset != null) params.set("offset", String(filters.offset));
  const qs = params.toString();
  return apiFetch<TourismCandidatesOverviewPage>(
    `/admin/tourism/candidates/overview${qs ? `?${qs}` : ""}`,
    { method: "GET", ...init },
  );
}

export function approveTourismCandidate(
  placePublicId: string,
  body: TourismProfileUpsertBody,
) {
  return apiFetch<TourismPlaceProfileAdmin>(
    `/admin/tourism/candidates/${encodeURIComponent(placePublicId)}/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function ignoreTourismCandidate(placePublicId: string, reason?: string) {
  return apiFetch<{ public_id: string; ignored: true }>(
    `/admin/tourism/candidates/${encodeURIComponent(placePublicId)}/ignore`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reason ? { reason } : {}),
    },
  );
}
