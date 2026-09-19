"use client";

import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { getAdminAreaOptions } from "@/src/lib/api";
import { tourismPath } from "@/src/lib/dashboardPaths";

import { listAdminActivityTypes, listAdminTourismActivities } from "./api";
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

function formatSeason(mode: string, start: number | null, end: number | null) {
  if (mode === "all_year") return "All year";
  if (mode === "temporarily_unavailable") return "Temporarily unavailable";
  if (start && end) return `${mode.replaceAll("_", " ")} (${start}–${end})`;
  return mode.replaceAll("_", " ");
}

function reviewBadgeClass(status: string) {
  if (status === "overdue") return "bg-red-100 text-red-800";
  if (status === "due_soon") return "bg-amber-100 text-amber-900";
  if (status === "current") return "bg-emerald-100 text-emerald-800";
  return "bg-gray-100 text-gray-600";
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function TourismActivitiesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const reviewStatus = (searchParams.get("review_status")?.trim() ||
    "") as TourismScheduleReviewFilter | "";
  const adminAreaId = searchParams.get("admin_area_id")?.trim() || "";
  const activityType = searchParams.get("activity_type")?.trim() || "";
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
      admin_area_id: adminAreaId || undefined,
      activity_type: activityType || undefined,
      is_active: isActive === "" ? undefined : isActive === "true",
      is_verified: isVerified === "" ? undefined : isVerified === "true",
      q: q || undefined,
      review_status: reviewStatus || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [adminAreaId, activityType, isActive, isVerified, q, reviewStatus, offset],
  );

  const listQuery = useQuery({
    queryKey: ["tourism-catalog", "activities", filters],
    queryFn: ({ signal }) => listAdminTourismActivities(filters, { signal }),
    placeholderData: keepPreviousData,
  });
  const needsReviewCountQuery = useQuery({
    queryKey: ["tourism-catalog", "activities", "needs-review-count"],
    queryFn: ({ signal }) =>
      listAdminTourismActivities(
        { review_status: "needs_review", limit: 1, offset: 0 },
        { signal },
      ),
    staleTime: 30_000,
  });
  const typesQuery = useQuery({
    queryKey: ["tourism-catalog", "activity-types"],
    queryFn: ({ signal }) => listAdminActivityTypes({ signal }),
    staleTime: 5 * 60 * 1000,
  });
  const areasQuery = useQuery({
    queryKey: ["admin-area-options", "tourism-activities", areaQuery],
    queryFn: () =>
      getAdminAreaOptions({ limit: 200, q: areaQuery || undefined, townshipOnly: true }),
  });

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const needsReviewCount = needsReviewCountQuery.data?.total ?? 0;
  const isNeedReviewTab = reviewStatus === "needs_review";

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Activities</h1>
          <p className="mt-1 text-sm text-gray-600">Curated tourism activities by township.</p>
        </div>
        <Link href={tourismPath("activities/new")} className={PRIMARY_BTN}>
          New activity
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-2">
        <button
          type="button"
          className={!reviewStatus ? TAB_ACTIVE : TAB_IDLE}
          onClick={() => replaceFilters({ review_status: null })}
        >
          All
        </button>
        <button
          type="button"
          className={reviewStatus === "needs_review" ? TAB_ACTIVE : TAB_IDLE}
          onClick={() => replaceFilters({ review_status: "needs_review" })}
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
            placeholder="Name"
          />
        </label>
        <label className="text-sm text-gray-700">
          Type
          <select
            value={activityType}
            onChange={(e) => replaceFilters({ activity_type: e.target.value || null })}
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
            placeholder="Filter townships"
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
          {listQuery.error instanceof Error ? listQuery.error.message : "Failed to load activities"}
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
                  <th className="px-3 py-2">Last schedule review</th>
                  <th className="px-3 py-2">Next review due</th>
                  <th className="px-3 py-2">Review state</th>
                </>
              ) : (
                <>
                  <th className="px-3 py-2">Township</th>
                  <th className="px-3 py-2">Season</th>
                  <th className="px-3 py-2">Review</th>
                  <th className="px-3 py-2">Verified</th>
                  <th className="px-3 py-2">Active</th>
                  <th className="px-3 py-2">Display priority</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.public_id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2">
                  <Link
                    href={tourismPath(`activities/${row.public_id}`)}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-gray-700">{row.activity_type_name_en}</td>
                {isNeedReviewTab ? (
                  <>
                    <td className="px-3 py-2 text-gray-700">
                      {formatWhen(row.last_schedule_reviewed_at)}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {formatWhen(row.next_review_due_at)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${reviewBadgeClass(row.review_status)}`}
                      >
                        {reviewStatusLabel(row.review_status)}
                      </span>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 text-gray-700">{row.admin_area_name}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {formatSeason(row.season_mode, row.season_start_month, row.season_end_month)}
                    </td>
                    <td className="px-3 py-2">
                      {row.requires_schedule_review ? (
                        <span
                          className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${reviewBadgeClass(row.review_status)}`}
                        >
                          {reviewStatusLabel(row.review_status)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{row.is_verified ? "Yes" : "No"}</td>
                    <td className="px-3 py-2">{row.is_active ? "Yes" : "No"}</td>
                    <td className="px-3 py-2">{row.display_priority}</td>
                  </>
                )}
              </tr>
            ))}
            {!listQuery.isLoading && items.length === 0 ? (
              <tr>
                <td colSpan={isNeedReviewTab ? 5 : 8} className="px-3 py-8 text-center text-gray-500">
                  No activities found.
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
