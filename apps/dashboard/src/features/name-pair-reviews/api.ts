import { apiFetch } from "@/src/lib/api";

import type {
  NamePairGapItem,
  NamePairReviewItem,
  NamePairReviewListFilters,
  NamePairSummary,
} from "./types";

export { NAME_PAIR_REASON_AUTO_APPLIED } from "./types";

type Signal = Pick<RequestInit, "signal">;

function toQs(filters: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function getNamePairSummary(init?: Signal) {
  return apiFetch<NamePairSummary>(`/admin/name-pair-reviews/summary`, {
    method: "GET",
    ...init,
  });
}

export function listNamePairReviews(filters: NamePairReviewListFilters, init?: Signal) {
  return apiFetch<{
    items: NamePairReviewItem[];
    total: number;
    limit: number;
    offset: number;
  }>(`/admin/name-pair-reviews${toQs(filters)}`, { method: "GET", ...init });
}

export function listNamePairGaps(
  filters: {
    bucket: "remain_non_street" | "remain_minor_streets";
    entity_type?: string;
    q?: string;
    limit?: number;
    offset?: number;
  },
  init?: Signal,
) {
  return apiFetch<{
    items: NamePairGapItem[];
    total: number;
    limit: number;
    offset: number;
    bucket: string;
  }>(`/admin/name-pair-reviews/gaps${toQs(filters)}`, { method: "GET", ...init });
}

export function approveNamePairReview(
  publicId: string,
  body: {
    proposed_mm?: string | null;
    proposed_en?: string | null;
    review_note?: string | null;
  },
) {
  return apiFetch<NamePairReviewItem>(
    `/admin/name-pair-reviews/${encodeURIComponent(publicId)}/approve`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function rejectNamePairReview(publicId: string, review_note?: string | null) {
  return apiFetch<NamePairReviewItem>(
    `/admin/name-pair-reviews/${encodeURIComponent(publicId)}/reject`,
    { method: "POST", body: JSON.stringify({ review_note: review_note ?? null }) },
  );
}

export function skipNamePairReview(publicId: string, review_note?: string | null) {
  return apiFetch<NamePairReviewItem>(
    `/admin/name-pair-reviews/${encodeURIComponent(publicId)}/skip`,
    { method: "POST", body: JSON.stringify({ review_note: review_note ?? null }) },
  );
}
