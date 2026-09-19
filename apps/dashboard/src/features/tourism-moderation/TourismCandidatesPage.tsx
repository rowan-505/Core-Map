"use client";

import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import AdminAreaCombobox from "@/src/components/admin-areas/AdminAreaCombobox";
import { getAdminAreaOptions } from "@/src/lib/api";
import { coreReviewPath, tourismPath } from "@/src/lib/dashboardPaths";

import {
  approveTourismCandidate,
  ignoreTourismCandidate,
  listAdminTourismCandidates,
  listAdminTourismCandidatesOverview,
  listTourismTypes,
  type TourismCandidateItem,
} from "./api";
import type { TourismTypeCode } from "./types";

const SELECT_CLASS =
  "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const PRIMARY_BTN =
  "rounded-md bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50";
const SECONDARY_BTN =
  "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const PAGE_SIZE = 25;
const CANDIDATE_CATEGORIES = [
  { code: "", label: "All likely tourism categories" },
  { code: "pagoda", label: "Pagoda" },
  { code: "monastery", label: "Monastery" },
  { code: "religion", label: "Religion" },
  { code: "entertainment", label: "Entertainment" },
  { code: "retreat", label: "Retreat" },
  { code: "market", label: "Market" },
  { code: "cemetery", label: "Cemetery" },
] as const;

function secondaryName(item: TourismCandidateItem): string | null {
  const primary = item.name.trim().toLowerCase();
  const mm = item.name_mm?.trim() || null;
  const en = item.name_en?.trim() || null;
  if (mm && mm.toLowerCase() !== primary) return mm;
  if (en && en.toLowerCase() !== primary) return en;
  return null;
}

function locationLine(item: TourismCandidateItem): string {
  const township = item.township_name?.trim();
  const region = item.region_name?.trim();
  if (township && region) return `${township} · ${region}`;
  if (township) return township;
  if (region) return region;
  return "Admin area unknown";
}

function placeEditHref(publicId: string): string {
  return coreReviewPath(`places/${publicId}/edit`);
}

export default function TourismCandidatesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const regionId = searchParams.get("region_admin_area_id")?.trim() || "";
  const townshipId = searchParams.get("township_admin_area_id")?.trim() || "";
  const categoryCode = searchParams.get("category_code")?.trim() || "";
  const q = searchParams.get("q")?.trim() || "";
  const offset = Number(searchParams.get("offset") || "0") || 0;
  const tab = searchParams.get("tab")?.trim() || "list";

  const [searchDraft, setSearchDraft] = useState(q);
  const [approvePlace, setApprovePlace] = useState<TourismCandidateItem | null>(null);
  const [tourismType, setTourismType] = useState<TourismTypeCode>("attraction");
  const [isPublic, setIsPublic] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const replaceFilters = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value == null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  const regionOptionsQuery = useQuery({
    queryKey: ["admin-area-options", "state_region", "tourism-candidates"],
    queryFn: () =>
      getAdminAreaOptions({
        limit: 100,
        stateRegionOnly: true,
      }),
    staleTime: 10 * 60 * 1000,
  });

  const townshipOptionsQuery = useQuery({
    queryKey: ["admin-area-options", "township", "tourism-candidates", regionId],
    queryFn: () =>
      getAdminAreaOptions({
        limit: 2000,
        townshipOnly: true,
        regionAdminAreaId: regionId || undefined,
      }),
    enabled: Boolean(regionId),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!regionId || !townshipId) return;
    const options = townshipOptionsQuery.data;
    if (!options) return;
    if (!options.some((row) => row.id === townshipId)) {
      replaceFilters({ township_admin_area_id: null, offset: "0" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset when region/township options change
  }, [regionId, townshipId, townshipOptionsQuery.data]);

  const candidatesQuery = useQuery({
    queryKey: [
      "admin-tourism-candidates",
      regionId,
      townshipId,
      categoryCode,
      q,
      offset,
    ],
    queryFn: ({ signal }) =>
      listAdminTourismCandidates(
        {
          region_admin_area_id: regionId || undefined,
          township_admin_area_id: townshipId || undefined,
          category_code: categoryCode || undefined,
          q: q || undefined,
          limit: PAGE_SIZE,
          offset,
        },
        { signal },
      ),
    enabled: tab === "list",
    placeholderData: keepPreviousData,
  });

  const overviewQuery = useQuery({
    queryKey: ["admin-tourism-candidates-overview", regionId],
    queryFn: ({ signal }) =>
      listAdminTourismCandidatesOverview(
        {
          region_admin_area_id: regionId || undefined,
          limit: 200,
          offset: 0,
        },
        { signal },
      ),
    enabled: tab === "overview",
  });

  const typesQuery = useQuery({
    queryKey: ["tourism-types"],
    queryFn: ({ signal }) => listTourismTypes({ signal }),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    const onFocus = () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-tourism-candidates"] });
      void queryClient.invalidateQueries({
        queryKey: ["admin-tourism-candidates-overview"],
      });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [queryClient]);

  const refreshCandidates = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-tourism-candidates"] });
    void queryClient.invalidateQueries({
      queryKey: ["admin-tourism-candidates-overview"],
    });
  };

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!approvePlace) throw new Error("No candidate selected");
      return approveTourismCandidate(approvePlace.public_id, {
        tourism_type: tourismType,
        editorial_score: 50,
        season_mode: "all_year",
        is_public: isPublic,
        manual_boost: 0,
        season_start_month: null,
        season_end_month: null,
      });
    },
    onSuccess: async (created) => {
      setApprovePlace(null);
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-tourism-candidates"] });
      await queryClient.invalidateQueries({
        queryKey: ["admin-tourism-candidates-overview"],
      });
      router.push(tourismPath(`places/${created.public_id}`));
    },
    onError: (error: Error) => {
      setActionError(error.message || "Could not approve candidate");
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: (publicId: string) => ignoreTourismCandidate(publicId, "ignored_by_curator"),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-tourism-candidates"] });
      await queryClient.invalidateQueries({
        queryKey: ["admin-tourism-candidates-overview"],
      });
    },
    onError: (error: Error) => {
      setActionError(error.message || "Could not ignore candidate");
    },
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Tourism candidates</h1>
          <p className="mt-1 text-sm text-gray-600">
            Find likely tourism places from CoreMap data. No auto-import — approve creates a
            tourism profile; ignore hides the candidate.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={SECONDARY_BTN} onClick={refreshCandidates}>
            Refresh
          </button>
          <Link href={coreReviewPath("places/new")} className={SECONDARY_BTN}>
            Missing attraction → create place
          </Link>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className={tab === "list" ? PRIMARY_BTN : SECONDARY_BTN}
          onClick={() => replaceFilters({ tab: "list" })}
        >
          Candidates
        </button>
        <button
          type="button"
          className={tab === "overview" ? PRIMARY_BTN : SECONDARY_BTN}
          onClick={() => replaceFilters({ tab: "overview", offset: null })}
        >
          Overview
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <label className="min-w-[14rem] space-y-1 text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Region / state
          </span>
          <AdminAreaCombobox
            value={regionId || null}
            onChange={(id) =>
              replaceFilters({
                region_admin_area_id: id,
                township_admin_area_id: null,
                offset: "0",
              })
            }
            options={regionOptionsQuery.data ?? []}
            optionsLoading={regionOptionsQuery.isLoading}
            placeholder="Search region / state…"
            className="w-full min-w-[14rem]"
          />
        </label>

        <label className="min-w-[14rem] space-y-1 text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Township
          </span>
          <AdminAreaCombobox
            value={townshipId || null}
            onChange={(id) =>
              replaceFilters({
                township_admin_area_id: id,
                offset: "0",
              })
            }
            options={townshipOptionsQuery.data ?? []}
            optionsLoading={Boolean(regionId) && townshipOptionsQuery.isLoading}
            disabled={!regionId}
            placeholder={regionId ? "Search township…" : "Select a region first"}
            className="w-full min-w-[14rem]"
          />
        </label>

        {tab === "list" ? (
          <>
            <label className="space-y-1 text-sm">
              <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Category
              </span>
              <select
                className={SELECT_CLASS}
                value={categoryCode}
                onChange={(e) =>
                  replaceFilters({
                    category_code: e.target.value || null,
                    offset: "0",
                  })
                }
              >
                {CANDIDATE_CATEGORIES.map((item) => (
                  <option key={item.code || "all"} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="min-w-[14rem] flex-1 space-y-1 text-sm">
              <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Search
              </span>
              <div className="flex gap-2">
                <input
                  className={SELECT_CLASS + " w-full"}
                  value={searchDraft}
                  placeholder="Place name…"
                  onChange={(e) => setSearchDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      replaceFilters({ q: searchDraft.trim() || null, offset: "0" });
                    }
                  }}
                />
                <button
                  type="button"
                  className={SECONDARY_BTN}
                  onClick={() =>
                    replaceFilters({ q: searchDraft.trim() || null, offset: "0" })
                  }
                >
                  Search
                </button>
              </div>
            </label>
          </>
        ) : null}
      </div>

      {actionError ? <p className="text-sm text-red-700">{actionError}</p> : null}

      {tab === "overview" ? (
        overviewQuery.isError ? (
          <p className="text-sm text-red-700">Could not load township overview.</p>
        ) : overviewQuery.isLoading ? (
          <p className="text-sm text-gray-600">Loading overview…</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Township</th>
                  <th className="px-3 py-2">Candidates</th>
                  <th className="px-3 py-2">Approved profiles</th>
                  <th className="px-3 py-2">Active public</th>
                  <th className="px-3 py-2">Verified</th>
                  <th className="px-3 py-2">Coverage</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {(overviewQuery.data?.items ?? []).map((row) => (
                  <tr key={row.township_admin_area_id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium">{row.township_name}</td>
                    <td className="px-3 py-2">{row.candidate_count}</td>
                    <td className="px-3 py-2">{row.approved_tourism_profiles}</td>
                    <td className="px-3 py-2">{row.active_public_profiles}</td>
                    <td className="px-3 py-2">{row.verified_profiles}</td>
                    <td className="px-3 py-2 capitalize">{row.coverage_status}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="text-xs font-medium text-gray-900 underline"
                        onClick={() =>
                          replaceFilters({
                            tab: "list",
                            township_admin_area_id: row.township_admin_area_id,
                            region_admin_area_id: row.region_admin_area_id,
                            offset: "0",
                          })
                        }
                      >
                        Open candidates
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : candidatesQuery.isError ? (
        <p className="text-sm text-red-700">Could not load tourism candidates.</p>
      ) : candidatesQuery.isLoading ? (
        <p className="text-sm text-gray-600">Loading candidates…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Place</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Suggested type</th>
                <th className="px-3 py-2">Importance</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(candidatesQuery.data?.items ?? []).map((item) => {
                const alias = secondaryName(item);
                const editHref = placeEditHref(item.public_id);
                return (
                  <tr key={item.public_id} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      <Link
                        href={editHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-gray-900 underline-offset-2 hover:underline"
                      >
                        {item.name}
                      </Link>
                      {alias ? (
                        <div className="text-xs text-gray-500">{alias}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {item.category_name || item.category_code || "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{locationLine(item)}</td>
                    <td className="px-3 py-2">{item.suggested_tourism_type}</td>
                    <td className="px-3 py-2">{item.importance_score ?? "—"}</td>
                    <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                      <Link
                        href={editHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-gray-900 underline"
                      >
                        Edit Place ↗
                      </Link>
                      <button
                        type="button"
                        className="text-xs font-medium text-gray-900 underline"
                        onClick={() => {
                          setApprovePlace(item);
                          setTourismType(item.suggested_tourism_type as TourismTypeCode);
                          setIsPublic(true);
                          setActionError(null);
                        }}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="text-xs font-medium text-gray-600 underline"
                        disabled={ignoreMutation.isPending}
                        onClick={() => ignoreMutation.mutate(item.public_id)}
                      >
                        Ignore
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 text-sm">
            <span className="text-gray-600">
              {candidatesQuery.data?.total ?? 0} candidates · offset {offset}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className={SECONDARY_BTN}
                disabled={offset <= 0}
                onClick={() =>
                  replaceFilters({ offset: String(Math.max(0, offset - PAGE_SIZE)) })
                }
              >
                Previous
              </button>
              <button
                type="button"
                className={SECONDARY_BTN}
                disabled={offset + PAGE_SIZE >= (candidatesQuery.data?.total ?? 0)}
                onClick={() => replaceFilters({ offset: String(offset + PAGE_SIZE) })}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {approvePlace ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-4 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Approve candidate</h2>
            <p className="text-sm text-gray-600">
              Creates a tourism profile from the current canonical place{" "}
              <span className="font-medium text-gray-900">{approvePlace.name}</span>.
            </p>
            <label className="block space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Tourism type
              </span>
              <select
                className={SELECT_CLASS + " w-full"}
                value={tourismType}
                onChange={(e) => setTourismType(e.target.value as TourismTypeCode)}
              >
                {(typesQuery.data?.items ?? []).map((type) => (
                  <option key={type.code} value={type.code}>
                    {type.name_en}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              Public tourism profile
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className={SECONDARY_BTN}
                onClick={() => setApprovePlace(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={PRIMARY_BTN}
                disabled={approveMutation.isPending}
                onClick={() => approveMutation.mutate()}
              >
                {approveMutation.isPending ? "Approving…" : "Approve"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
