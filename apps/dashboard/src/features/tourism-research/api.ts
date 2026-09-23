import { apiFetch } from "@/src/lib/api";

import type {
  TourismResearchCandidateDetail,
  TourismResearchListFilters,
  TourismResearchPrefillResponse,
} from "./types";
import type { TourismResearchCandidate } from "./types";

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

export function listAdminTourismResearch(filters: TourismResearchListFilters, init?: Signal) {
  return apiFetch<{
    items: TourismResearchCandidate[];
    total: number;
    limit: number;
    offset: number;
  }>(`/admin/tourism/research${toQs(filters)}`, { method: "GET", ...init });
}

export function getAdminTourismResearch(publicId: string, init?: Signal) {
  return apiFetch<TourismResearchCandidateDetail>(
    `/admin/tourism/research/${encodeURIComponent(publicId)}`,
    { method: "GET", ...init },
  );
}

export function getAdminTourismResearchPrefill(publicId: string, init?: Signal) {
  return apiFetch<TourismResearchPrefillResponse>(
    `/admin/tourism/research/${encodeURIComponent(publicId)}/prefill`,
    { method: "GET", ...init },
  );
}

export function markAdminTourismResearchReviewing(publicId: string) {
  return apiFetch<TourismResearchCandidateDetail>(
    `/admin/tourism/research/${encodeURIComponent(publicId)}/reviewing`,
    { method: "POST" },
  );
}

export function markAdminTourismResearchRejected(publicId: string) {
  return apiFetch<TourismResearchCandidateDetail>(
    `/admin/tourism/research/${encodeURIComponent(publicId)}/reject`,
    { method: "POST" },
  );
}

export function markAdminTourismResearchNeedsResearch(publicId: string) {
  return apiFetch<TourismResearchCandidateDetail>(
    `/admin/tourism/research/${encodeURIComponent(publicId)}/needs-research`,
    { method: "POST" },
  );
}

export function markAdminTourismResearchAdded(
  publicId: string,
  body: { created_entity_type: string; created_entity_public_id: string },
) {
  return apiFetch<TourismResearchCandidateDetail>(
    `/admin/tourism/research/${encodeURIComponent(publicId)}/added`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}
