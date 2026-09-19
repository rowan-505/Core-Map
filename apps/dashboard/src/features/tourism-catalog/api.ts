import { apiFetch } from "@/src/lib/api";

import type {
  TourismActivityAdmin,
  TourismActivityListFilters,
  TourismCatalogType,
  TourismEventAdmin,
  TourismEventListFilters,
  TourismOccurrenceAdmin,
} from "./types";

export type ConfirmScheduleReviewBody = {
  next_review_due_at: string;
  schedule_review_note?: string | null;
  requires_schedule_review?: boolean;
};

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

export function listAdminActivityTypes(init?: Signal) {
  return apiFetch<{ items: TourismCatalogType[] }>("/admin/tourism/activity-types", {
    method: "GET",
    ...init,
  });
}

export function listAdminEventTypes(init?: Signal) {
  return apiFetch<{ items: TourismCatalogType[] }>("/admin/tourism/event-types", {
    method: "GET",
    ...init,
  });
}

export function listAdminTourismActivities(
  filters: TourismActivityListFilters,
  init?: Signal,
) {
  return apiFetch<{
    items: TourismActivityAdmin[];
    total: number;
    limit: number;
    offset: number;
  }>(`/admin/tourism/activities${toQs(filters)}`, { method: "GET", ...init });
}

export function getAdminTourismActivity(publicId: string, init?: Signal) {
  return apiFetch<TourismActivityAdmin>(
    `/admin/tourism/activities/${encodeURIComponent(publicId)}`,
    { method: "GET", ...init },
  );
}

export function createAdminTourismActivity(body: Record<string, unknown>) {
  return apiFetch<TourismActivityAdmin>("/admin/tourism/activities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateAdminTourismActivity(
  publicId: string,
  body: Record<string, unknown>,
) {
  return apiFetch<TourismActivityAdmin>(
    `/admin/tourism/activities/${encodeURIComponent(publicId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function listAdminTourismEvents(
  filters: TourismEventListFilters,
  init?: Signal,
) {
  return apiFetch<{
    items: TourismEventAdmin[];
    total: number;
    limit: number;
    offset: number;
    tab: string;
  }>(`/admin/tourism/events${toQs(filters)}`, { method: "GET", ...init });
}

export function getAdminTourismEvent(publicId: string, init?: Signal) {
  return apiFetch<TourismEventAdmin>(
    `/admin/tourism/events/${encodeURIComponent(publicId)}`,
    { method: "GET", ...init },
  );
}

export function createAdminTourismEvent(body: Record<string, unknown>) {
  return apiFetch<TourismEventAdmin>("/admin/tourism/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateAdminTourismEvent(
  publicId: string,
  body: Record<string, unknown>,
) {
  return apiFetch<TourismEventAdmin>(
    `/admin/tourism/events/${encodeURIComponent(publicId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function listAdminTourismOccurrences(
  eventPublicId: string,
  init?: Signal,
) {
  return apiFetch<{
    items: TourismOccurrenceAdmin[];
    total: number;
  }>(
    `/admin/tourism/events/${encodeURIComponent(eventPublicId)}/occurrences`,
    { method: "GET", ...init },
  );
}

export function createAdminTourismOccurrence(
  eventPublicId: string,
  body: Record<string, unknown>,
) {
  return apiFetch<TourismOccurrenceAdmin>(
    `/admin/tourism/events/${encodeURIComponent(eventPublicId)}/occurrences`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function updateAdminTourismOccurrence(
  eventPublicId: string,
  occurrencePublicId: string,
  body: Record<string, unknown>,
) {
  return apiFetch<TourismOccurrenceAdmin>(
    `/admin/tourism/events/${encodeURIComponent(eventPublicId)}/occurrences/${encodeURIComponent(occurrencePublicId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function confirmAdminTourismActivityScheduleReview(
  publicId: string,
  body: ConfirmScheduleReviewBody,
) {
  return apiFetch<TourismActivityAdmin>(
    `/admin/tourism/activities/${encodeURIComponent(publicId)}/schedule-review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function confirmAdminTourismEventScheduleReview(
  publicId: string,
  body: ConfirmScheduleReviewBody,
) {
  return apiFetch<TourismEventAdmin>(
    `/admin/tourism/events/${encodeURIComponent(publicId)}/schedule-review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}
