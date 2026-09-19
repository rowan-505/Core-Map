"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch, isAbortError } from "@/src/lib/api";
import { coreReviewPath } from "@/src/lib/dashboardPaths";

const INPUT_CLASS =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50 disabled:text-gray-500";
const SECONDARY_BTN =
  "rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const LINK_BTN =
  "rounded-md border border-dashed border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50";

export type CorePlaceSelection = {
  public_id: string;
  display_name: string;
  category_name?: string | null;
  township_name?: string | null;
  region_name?: string | null;
  has_tourism_profile?: boolean;
  is_verified?: boolean;
};

export type TourismPlaceSearchItem = {
  public_id: string;
  display_name: string;
  category_code: string | null;
  category_name: string | null;
  township_name: string | null;
  region_name: string | null;
  has_tourism_profile: boolean;
  is_verified: boolean;
};

export type TourismPlaceSearchResponse = {
  admin_area_id: string;
  township_name: string | null;
  region_name: string | null;
  limit: number;
  items: TourismPlaceSearchItem[];
};

export function buildCreatePlaceUrl(townshipId: string | null | undefined): string {
  const base = coreReviewPath("places/new");
  if (!townshipId) return base;
  const params = new URLSearchParams({ adminAreaId: townshipId });
  return `${base}?${params.toString()}`;
}

export function canSelectPlaceForAttraction(item: {
  has_tourism_profile?: boolean;
}): boolean {
  return item.has_tourism_profile !== true;
}

export async function searchTourismPlacesForPicker(
  input: { admin_area_id: string; q: string; limit?: number },
  init?: Pick<RequestInit, "signal">,
): Promise<TourismPlaceSearchResponse> {
  const params = new URLSearchParams({
    admin_area_id: input.admin_area_id,
    q: input.q,
  });
  if (input.limit != null) params.set("limit", String(input.limit));
  return apiFetch<TourismPlaceSearchResponse>(
    `/admin/tourism/places/search?${params.toString()}`,
    { method: "GET", ...init },
  );
}

type CorePlacePickerProps = {
  selectedTownshipId: string | null | undefined;
  value: CorePlaceSelection | null;
  onChange: (place: CorePlaceSelection | null) => void;
  required?: boolean;
  disabled?: boolean;
  /** Attractions: block places that already have tourism.place_profiles */
  blockExistingTourismProfiles?: boolean;
};

/**
 * Township-first CoreMap place picker for Tourism Attractions / Activities / Events.
 */
export default function CorePlacePicker({
  selectedTownshipId,
  value,
  onChange,
  required = false,
  disabled = false,
  blockExistingTourismProfiles = false,
}: CorePlacePickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TourismPlaceSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [picking, setPicking] = useState(!value);

  const townshipReady = Boolean(selectedTownshipId?.trim());
  const searchDisabled = disabled || !townshipReady;

  const runSearch = useCallback(
    async (q: string, signal?: AbortSignal) => {
      const trimmed = q.trim();
      const townshipId = selectedTownshipId?.trim();
      if (!townshipId || trimmed.length < 2) {
        setResults([]);
        setError("");
        setSearched(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const res = await searchTourismPlacesForPicker(
          { admin_area_id: townshipId, q: trimmed, limit: 15 },
          signal ? { signal } : undefined,
        );
        setResults(res.items);
        setSearched(true);
      } catch (err) {
        if (isAbortError(err)) return;
        setError(err instanceof Error ? err.message : "Place search failed.");
        setResults([]);
        setSearched(true);
      } finally {
        setLoading(false);
      }
    },
    [selectedTownshipId],
  );

  useEffect(() => {
    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      void runSearch(query, controller.signal);
    }, 300);
    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [query, runSearch, refreshNonce]);

  useEffect(() => {
    const onFocus = () => {
      if (!townshipReady || query.trim().length < 2) return;
      setRefreshNonce((n) => n + 1);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [townshipReady, query]);

  useEffect(() => {
    if (value) setPicking(false);
  }, [value]);

  useEffect(() => {
    // Township change clears stale selection search UI.
    setQuery("");
    setResults([]);
    setError("");
    setSearched(false);
  }, [selectedTownshipId]);

  function openCreatePlace() {
    const url = buildCreatePlaceUrl(selectedTownshipId);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  if (value && !picking) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="font-medium text-emerald-950">{value.display_name}</div>
            <div className="text-xs text-emerald-900/80">
              {[value.category_name, value.township_name, value.region_name]
                .filter(Boolean)
                .join(" · ") || "Selected CoreMap place"}
            </div>
          </div>
          {!disabled ? (
            <div className="flex shrink-0 flex-wrap gap-1">
              <button
                type="button"
                className={SECONDARY_BTN}
                onClick={() => {
                  setPicking(true);
                  setQuery("");
                  setResults([]);
                }}
              >
                Change
              </button>
              {!required ? (
                <button type="button" className={SECONDARY_BTN} onClick={() => onChange(null)}>
                  Clear
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!townshipReady ? (
        <p className="text-sm text-amber-800">Select a township first to search places.</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={query}
          disabled={searchDisabled}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            townshipReady ? "Search places by name (min 2 characters)…" : "Select township first…"
          }
          className={`${INPUT_CLASS} min-w-[14rem] flex-1`}
          aria-required={required}
        />
        <button
          type="button"
          className={SECONDARY_BTN}
          disabled={searchDisabled || query.trim().length < 2 || loading}
          onClick={() => setRefreshNonce((n) => n + 1)}
        >
          Refresh
        </button>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="text-sm text-gray-500">Searching places…</p> : null}

      {!loading && searched && results.length === 0 && !error && query.trim().length >= 2 ? (
        <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          <p>No places found in this township.</p>
          <button type="button" className={LINK_BTN} onClick={openCreatePlace}>
            Create New Place
          </button>
        </div>
      ) : null}

      {results.length > 0 ? (
        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-gray-200 bg-white p-1">
          {results.map((item) => {
            const blocked =
              blockExistingTourismProfiles && !canSelectPlaceForAttraction(item);
            return (
              <li key={item.public_id}>
                <button
                  type="button"
                  disabled={blocked || disabled}
                  className={`w-full rounded px-2 py-2 text-left text-sm ${
                    blocked
                      ? "cursor-not-allowed bg-gray-50 text-gray-500"
                      : "hover:bg-gray-50"
                  }`}
                  onClick={() => {
                    if (blocked) return;
                    onChange({
                      public_id: item.public_id,
                      display_name: item.display_name,
                      category_name: item.category_name,
                      township_name: item.township_name,
                      region_name: item.region_name,
                      has_tourism_profile: item.has_tourism_profile,
                      is_verified: item.is_verified,
                    });
                    setPicking(false);
                    setQuery("");
                    setResults([]);
                  }}
                >
                  <div className="font-medium text-gray-900">{item.display_name}</div>
                  <div className="text-xs text-gray-500">
                    {[item.category_name, item.township_name, item.region_name]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {blocked ? (
                    <div className="mt-0.5 text-xs font-medium text-amber-800">
                      Already a tourism attraction
                    </div>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {townshipReady && query.trim().length >= 2 && !loading ? (
        <button type="button" className={LINK_BTN} onClick={openCreatePlace}>
          Create New Place
        </button>
      ) : null}

      {value && picking && !disabled ? (
        <button type="button" className={SECONDARY_BTN} onClick={() => setPicking(false)}>
          Cancel change
        </button>
      ) : null}
    </div>
  );
}
