import { apiFetch } from "@/src/lib/api";

import { buildAdminPlaceReviewsPath } from "./filters";
import type {
  PlaceReviewModerationAction,
  PlaceReviewDetail,
  PlaceReviewListFilters,
  PlaceReviewPage,
} from "./types";

type Signal = Pick<RequestInit, "signal">;

type PlaceReviewListItemLike = PlaceReviewPage["items"][number];

export function listAdminPlaceReviews(
  filters: PlaceReviewListFilters,
  init?: Signal,
) {
  return apiFetch<PlaceReviewPage>(buildAdminPlaceReviewsPath(filters), {
    method: "GET",
    ...init,
  });
}

export function getAdminPlaceReview(publicId: string, init?: Signal) {
  return apiFetch<PlaceReviewDetail>(
    `/admin/reviews/${encodeURIComponent(publicId)}`,
    { method: "GET", ...init },
  );
}

export function moderatePlaceReview(
  publicId: string,
  action: PlaceReviewModerationAction,
  note?: string,
) {
  return apiFetch<PlaceReviewListItemLike>(
    `/admin/reviews/${encodeURIComponent(publicId)}/${encodeURIComponent(action)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(note ? { note } : {}),
    },
  );
}
