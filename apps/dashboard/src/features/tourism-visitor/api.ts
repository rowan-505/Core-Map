import { apiFetch } from "@/src/lib/api";

import type {
  TourismAdvisoryAdmin,
  TourismAdvisoryListFilters,
  TourismFoodAdmin,
  TourismFoodListFilters,
  TourismFoodPlaceLink,
  TourismGuideAdmin,
  TourismGuideListFilters,
} from "./types";

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

export function listAdminTourismFoods(filters: TourismFoodListFilters, init?: Signal) {
  return apiFetch<{
    items: TourismFoodAdmin[];
    total: number;
    limit: number;
    offset: number;
  }>(`/admin/tourism/foods${toQs(filters)}`, { method: "GET", ...init });
}

export function getAdminTourismFood(publicId: string, init?: Signal) {
  return apiFetch<TourismFoodAdmin>(
    `/admin/tourism/foods/${encodeURIComponent(publicId)}`,
    { method: "GET", ...init },
  );
}

export function createAdminTourismFood(body: Record<string, unknown>) {
  return apiFetch<TourismFoodAdmin>("/admin/tourism/foods", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateAdminTourismFood(publicId: string, body: Record<string, unknown>) {
  return apiFetch<TourismFoodAdmin>(
    `/admin/tourism/foods/${encodeURIComponent(publicId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function createAdminTourismFoodPlaceLink(
  foodPublicId: string,
  body: Record<string, unknown>,
) {
  return apiFetch<TourismFoodPlaceLink>(
    `/admin/tourism/foods/${encodeURIComponent(foodPublicId)}/places`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function deleteAdminTourismFoodPlaceLink(
  foodPublicId: string,
  placePublicId: string,
) {
  return apiFetch<{ deleted: true }>(
    `/admin/tourism/foods/${encodeURIComponent(foodPublicId)}/places/${encodeURIComponent(placePublicId)}`,
    { method: "DELETE" },
  );
}

export function listAdminTourismGuides(filters: TourismGuideListFilters, init?: Signal) {
  return apiFetch<{
    items: TourismGuideAdmin[];
    total: number;
    limit: number;
    offset: number;
  }>(`/admin/tourism/guides${toQs(filters)}`, { method: "GET", ...init });
}

export function getAdminTourismGuide(publicId: string, init?: Signal) {
  return apiFetch<TourismGuideAdmin>(
    `/admin/tourism/guides/${encodeURIComponent(publicId)}`,
    { method: "GET", ...init },
  );
}

export function createAdminTourismGuide(body: Record<string, unknown>) {
  return apiFetch<TourismGuideAdmin>("/admin/tourism/guides", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateAdminTourismGuide(publicId: string, body: Record<string, unknown>) {
  return apiFetch<TourismGuideAdmin>(
    `/admin/tourism/guides/${encodeURIComponent(publicId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function listAdminTourismAdvisories(
  filters: TourismAdvisoryListFilters,
  init?: Signal,
) {
  return apiFetch<{
    items: TourismAdvisoryAdmin[];
    total: number;
    limit: number;
    offset: number;
  }>(`/admin/tourism/advisories${toQs(filters)}`, { method: "GET", ...init });
}

export function getAdminTourismAdvisory(publicId: string, init?: Signal) {
  return apiFetch<TourismAdvisoryAdmin>(
    `/admin/tourism/advisories/${encodeURIComponent(publicId)}`,
    { method: "GET", ...init },
  );
}

export function createAdminTourismAdvisory(body: Record<string, unknown>) {
  return apiFetch<TourismAdvisoryAdmin>("/admin/tourism/advisories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateAdminTourismAdvisory(publicId: string, body: Record<string, unknown>) {
  return apiFetch<TourismAdvisoryAdmin>(
    `/admin/tourism/advisories/${encodeURIComponent(publicId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}
