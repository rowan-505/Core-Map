"use client";

import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { getAdminAreaOptions } from "@/src/lib/api";
import { tourismPath } from "@/src/lib/dashboardPaths";

import { listAdminEventTypes, listAdminTourismEvents } from "./api";
import {
  reviewStatusLabel,
  type TourismScheduleReviewFilter,
} from "./types";

const SELECT_CLASS =
  "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const PRIMARY_BTN =
  "rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800";
const SECONDARY_BTN =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const TAB_ACTIVE = "rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white";
const TAB_IDLE =
  "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50";
const PAGE_SIZE = 20;

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function reviewBadgeClass(status: string) {
  if (status === "overdue") return "bg-red-100 text-red-800";
  if (status === "due_soon") return "bg-amber-100 text-amber-900";
  if (status === "current") return "bg-emerald-100 text-emerald-800";
  return "bg-gray-100 text-gray-600";
}

export default function TourismEventsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tab = (searchParams.get("tab")?.trim() || "all") as "all" | "upcoming";
  const reviewStatus = (searchParams.get("review_status")?.trim() ||
    "") as TourismScheduleReviewFilter | "";
  const adminAreaId = searchParams.get("admin_area_id")?.trim() || "";
  const eventType = searchParams.get("event_type")?.trim() || "";
  const isActive = searchParams.get("is_active")?.trim() || "";
  const isVerified = searchParams.get("is_verified")?.trim() || "";
  const q = searchParams.get("q")?.trim() || "";
  const offset = Number(searchParams.get("offset") || "0") || 0;
  const [searchDraft, setSearchDraft] = useState(q);
  const [areaQuery, setAreaQuery] = useState("");

  const replaceFilters = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    if (!("offset" in patch)) next.delete("offset");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const filters = useMemo(
    () => ({
      tab: reviewStatus ? "all" : tab,
      admin_area_id: adminAreaId || undefined,
      event_type: eventType || undefined,
      is_active: isActive === "" ? undefined : isActive === "true",
      is_verified: isVerified === "" ? undefined : isVerified === "true",
      q: q || undefined,
      review_status: reviewStatus || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [tab, reviewStatus, adminAreaId, eventType, isActive, isVerified, q, offset],
  );

  const listQuery = useQuery({
    queryKey: ["tourism-catalog", "events", filters],
    queryFn: ({ signal }) => listAdminTourismEvents(filters, { signal }),
    placeholderData: keepPreviousData,
  });
  const needsReviewCountQuery = useQuery({
    queryKey: ["tourism-catalog", "events", "needs-review-count"],
    queryFn: ({ signal }) =>
      listAdminTourismEvents(
        { review_status: "needs_review", tab: "all", limit: 1, offset: 0 },
        { signal },
      ),
    staleTime: 30_000,
  });
  const typesQuery = useQuery({
    queryKey: ["tourism-catalog", "event-types"],
    queryFn: ({ signal }) => listAdminEventTypes({ signal }),
    staleTime: 5 * 60 * 1000,
  });
  const areasQuery = useQuery({
    queryKey: ["admin-area-options", "tourism-events", areaQuery],
    queryFn: () =>
      getAdminAreaOptions({ limit: 200, q: areaQuery || undefined, townshipOnly: true }),
  });

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const needsReviewCount = needsReviewCountQuery.data?.total ?? 0;
  const activeMainTab = reviewStatus ? "needs_review" : tab;
  const isNeedReviewTab = activeMainTab === "needs_review";

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Events</h1>
          <p className="mt-1 text-sm text-gray-600">
            Festivals and events. Dates live on occurrences.
          </p>
        </div>
        <Link href={tourismPath("events/new")} className={PRIMARY_BTN}>
          New event
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-2">
        <button
          type="button"
          className={activeMainTab === "all" ? TAB_ACTIVE : TAB_IDLE}
          onClick={() => replaceFilters({ tab: "all", review_status: null })}
        >
          All
        </button>
        <button
          type="button"
          className={activeMainTab === "upcoming" ? TAB_ACTIVE : TAB_IDLE}
          onClick={() => replaceFilters({ tab: "upcoming", review_status: null })}
        >
          Upcoming
        </button>
        <button
          type="button"
          className={activeMainTab === "needs_review" ? TAB_ACTIVE : TAB_IDLE}
          onClick={() => replaceFilters({ tab: null, review_status: "needs_review" })}
        >
          Need Review
          {needsReviewCount > 0 ? (
            <span className="ml-1.5 inline-flex min-w-[1.25rem] justify-center rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-900">
              {needsReviewCount}
            </span>
          ) : null}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-gray-700">
          Search
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") replaceFilters({ q: searchDraft.trim() || null });
            }}
            className={`${SELECT_CLASS} ml-2 w-48`}
          />
        </label>
        <label className="text-sm text-gray-700">
          Type
          <select
            value={eventType}
            onChange={(e) => replaceFilters({ event_type: e.target.value || null })}
            className={`${SELECT_CLASS} ml-2`}
          >
            <option value="">All types</option>
            {(typesQuery.data?.items ?? []).map((type) => (
              <option key={type.code} value={type.code}>
                {type.name_en}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-700">
          Township
          <input
            value={areaQuery}
            onChange={(e) => setAreaQuery(e.target.value)}
            className={`${SELECT_CLASS} ml-2 w-36`}
            placeholder="Filter"
          />
          <select
            value={adminAreaId}
            onChange={(e) => replaceFilters({ admin_area_id: e.target.value || null })}
            className={`${SELECT_CLASS} ml-2 max-w-xs`}
          >
            <option value="">All townships</option>
            {(areasQuery.data ?? []).map((area) => (
              <option key={area.id} value={area.id}>
                {area.canonical_name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-700">
          Active
          <select
            value={isActive}
            onChange={(e) => replaceFilters({ is_active: e.target.value || null })}
            className={`${SELECT_CLASS} ml-2`}
          >
            <option value="">Any</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
        <label className="text-sm text-gray-700">
          Verified
          <select
            value={isVerified}
            onChange={(e) => replaceFilters({ is_verified: e.target.value || null })}
            className={`${SELECT_CLASS} ml-2`}
          >
            <option value="">Any</option>
            <option value="true">Verified</option>
            <option value="false">Unverified</option>
          </select>
        </label>
        <button
          type="button"
          className={SECONDARY_BTN}
          onClick={() => replaceFilters({ q: searchDraft.trim() || null })}
        >
          Apply
        </button>
      </div>

      {listQuery.isError ? (
        <p className="text-sm text-red-700">
          {listQuery.error instanceof Error ? listQuery.error.message : "Failed to load events"}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              {isNeedReviewTab ? (
                <>
                  <th className="px-3 py-2">Last occurrence</th>
                  <th className="px-3 py-2">Last schedule review</th>
                  <th className="px-3 py-2">Next review due</th>
                  <th className="px-3 py-2">Review state</th>
                  <th className="px-3 py-2">Next occurrence</th>
                </>
              ) : (
                <>
                  <th className="px-3 py-2">Township</th>
                  <th className="px-3 py-2">Review</th>
                  <th className="px-3 py-2">Verified</th>
                  <th className="px-3 py-2">Active</th>
                  <th className="px-3 py-2">Next occurrence</th>
                  <th className="px-3 py-2">Next review due</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.public_id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2">
                  <Link
                    href={tourismPath(`events/${row.public_id}`)}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {row.name}
                  </Link>
                  {row.missing_next_occurrence ? (
                    <span className="ml-2 inline-flex rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-900">
                      Missing next
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-gray-700">{row.event_type_name_en}</td>
                {isNeedReviewTab ? (
                  <>
                    <td className="px-3 py-2 text-gray-700">
                      {row.last_occurrence
                        ? `${formatWhen(row.last_occurrence.starts_at)} (${row.last_occurrence.status})`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {formatWhen(row.last_schedule_reviewed_at)}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {formatWhen(row.next_review_due_at)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${
                          row.missing_next_occurrence
                            ? "bg-orange-100 text-orange-900"
                            : reviewBadgeClass(row.review_status)
                        }`}
                      >
                        {row.missing_next_occurrence
                          ? "Missing next occurrence"
                          : reviewStatusLabel(row.review_status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {row.next_occurrence
                        ? `${formatWhen(row.next_occurrence.starts_at)} (${row.next_occurrence.status})`
                        : "—"}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 text-gray-700">{row.admin_area_name}</td>
                    <td className="px-3 py-2">
                      {row.requires_schedule_review || row.missing_next_occurrence ? (
                        <span
                          className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${reviewBadgeClass(row.review_status)}`}
                        >
                          {row.missing_next_occurrence && row.review_status === "none"
                            ? "Missing next"
                            : reviewStatusLabel(row.review_status)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{row.is_verified ? "Yes" : "No"}</td>
                    <td className="px-3 py-2">{row.is_active ? "Yes" : "No"}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {row.next_occurrence
                        ? `${formatWhen(row.next_occurrence.starts_at)} (${row.next_occurrence.status})`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {formatWhen(row.next_review_due_at)}
                    </td>
                  </>
                )}
              </tr>
            ))}
            {!listQuery.isLoading && items.length === 0 ? (
              <tr>
                <td colSpan={isNeedReviewTab ? 7 : 8} className="px-3 py-8 text-center text-gray-500">
                  No events found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={SECONDARY_BTN}
          disabled={offset <= 0}
          onClick={() =>
            replaceFilters({ offset: String(Math.max(0, offset - PAGE_SIZE)) || null })
          }
        >
          Previous
        </button>
        <button
          type="button"
          className={SECONDARY_BTN}
          disabled={offset + PAGE_SIZE >= total}
          onClick={() => replaceFilters({ offset: String(offset + PAGE_SIZE) })}
        >
          Next
        </button>
        <span className="text-sm text-gray-500">
          {total === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)}`} of {total}
        </span>
      </div>
    </div>
  );
}
