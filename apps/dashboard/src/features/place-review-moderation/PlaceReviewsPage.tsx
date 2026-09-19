"use client";

import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { reviewsPath, usersPath } from "@/src/lib/dashboardPaths";

import {
  getAdminPlaceReview,
  listAdminPlaceReviews,
} from "@/src/features/place-review-moderation/api";
import {
  formatDateTime,
  previewText,
  TOURISM_STATUS_FILTERS,
  tourismStatusBadgeClass,
  tourismStatusLabel,
} from "./constants";
import {
  parseTourismStatusFilter,
  permissionDeniedMessage,
  popCursorPage,
  pushCursorPage,
} from "./filters";
import { PlaceReviewDetailDrawer } from "./PlaceReviewDetailDrawer";
import type { PlaceReviewStatus } from "./types";

const PAGE_SIZE = 20;
const SELECT_CLASS =
  "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const SECONDARY_BTN =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function PlaceReviewsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const status = parseTourismStatusFilter(searchParams.get("status"));
  const placeId = searchParams.get("placeId")?.trim() ?? "";
  const authorId = searchParams.get("authorId")?.trim() ?? "";
  const search = searchParams.get("q")?.trim() ?? "";
  const selectedId = searchParams.get("review")?.trim() ?? "";

  const filterKey = `${status}|${placeId}|${authorId}|${search}`;
  const draftKey = `${search}|${placeId}|${authorId}`;

  const [searchDraft, setSearchDraft] = useState(search);
  const [placeDraft, setPlaceDraft] = useState(placeId);
  const [authorDraft, setAuthorDraft] = useState(authorId);
  const [syncedDraftKey, setSyncedDraftKey] = useState(draftKey);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [syncedFilterKey, setSyncedFilterKey] = useState(filterKey);

  if (draftKey !== syncedDraftKey) {
    setSyncedDraftKey(draftKey);
    setSearchDraft(search);
    setPlaceDraft(placeId);
    setAuthorDraft(authorId);
  }

  if (filterKey !== syncedFilterKey) {
    setSyncedFilterKey(filterKey);
    setCursorStack([null]);
  }

  const pageIndex = cursorStack.length - 1;
  const cursor = cursorStack[pageIndex] ?? null;

  const replaceFilters = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (!value) next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const listFilters = useMemo(
    () => ({
      status,
      placeId: placeId || undefined,
      authorId: authorId || undefined,
      q: search || undefined,
      cursor: cursor ?? undefined,
      limit: PAGE_SIZE,
    }),
    [status, placeId, authorId, search, cursor],
  );

  const query = useQuery({
    queryKey: ["tourism-moderation", "reviews", listFilters],
    queryFn: ({ signal }) => listAdminPlaceReviews(listFilters, { signal }),
    placeholderData: keepPreviousData,
  });

  const drawerQuery = useQuery({
    queryKey: ["tourism-moderation", "review-drawer", selectedId],
    enabled: Boolean(selectedId),
    queryFn: ({ signal }) => getAdminPlaceReview(selectedId, { signal }),
  });

  const items = query.data?.items ?? [];
  const nextCursor = query.data?.next_cursor ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Place Reviews</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Moderate reviews for all public places. Soft-deleted reviews stay excluded from restore.
          </p>
        </div>
        <button
          type="button"
          className={SECONDARY_BTN}
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {TOURISM_STATUS_FILTERS.map((option) => {
          const active = status === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${
                active
                  ? "bg-gray-900 text-white ring-gray-900"
                  : "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50"
              }`}
              onClick={() =>
                replaceFilters({
                  status: option.id === "all" ? null : option.id,
                })
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <form
        className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          replaceFilters({
            q: searchDraft.trim() || null,
            placeId: placeDraft.trim() || null,
            authorId: authorDraft.trim() || null,
          });
        }}
      >
        <label className="space-y-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Place ID
          </span>
          <input
            value={placeDraft}
            onChange={(e) => setPlaceDraft(e.target.value)}
            placeholder="Place public UUID"
            className={`${SELECT_CLASS} min-w-[14rem]`}
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Author ID
          </span>
          <input
            value={authorDraft}
            onChange={(e) => setAuthorDraft(e.target.value)}
            placeholder="Author public UUID"
            className={`${SELECT_CLASS} min-w-[14rem]`}
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Search place UUID
          </span>
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Quick place filter"
            className={`${SELECT_CLASS} min-w-[14rem]`}
          />
        </label>
        <button type="submit" className={SECONDARY_BTN}>
          Apply filters
        </button>
      </form>

      {query.isLoading ? (
        <p className="text-sm text-gray-500">Loading place reviews…</p>
      ) : null}

      {query.isError ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {permissionDeniedMessage(query.error)}
        </div>
      ) : null}

      {!query.isLoading && !query.isError && items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-sm text-gray-600">
          No reviews match these filters.
        </p>
      ) : null}

      {items.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Review</th>
                <th className="px-4 py-3">Author</th>
                <th className="px-4 py-3">Place</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.public_id} className="hover:bg-gray-50/80">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">
                      {item.title?.trim() || `Rating ${item.rating}/5`}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {previewText(item.body, 90)}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={usersPath(item.author.public_id)}
                      className="font-medium text-gray-800 hover:underline"
                    >
                      {item.author.display_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {item.place_public_id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${tourismStatusBadgeClass(item.status as PlaceReviewStatus)}`}
                    >
                      {tourismStatusLabel(item.status as PlaceReviewStatus)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {formatDateTime(item.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="text-sm font-medium text-gray-700 hover:underline"
                        onClick={() => replaceFilters({ review: item.public_id })}
                      >
                        Drawer
                      </button>
                      <Link
                        href={reviewsPath(item.public_id)}
                        className="text-sm font-semibold text-gray-900 hover:underline"
                      >
                        Open
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          Page {pageIndex + 1}
          {nextCursor ? " · more available" : ""}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className={SECONDARY_BTN}
            disabled={pageIndex === 0 || query.isFetching}
            onClick={() => setCursorStack((stack) => popCursorPage(stack))}
          >
            Previous
          </button>
          <button
            type="button"
            className={SECONDARY_BTN}
            disabled={!nextCursor || query.isFetching}
            onClick={() =>
              setCursorStack((stack) => pushCursorPage(stack, nextCursor))
            }
          >
            Next
          </button>
        </div>
      </div>

      <PlaceReviewDetailDrawer
        open={Boolean(selectedId)}
        detail={drawerQuery.data ?? null}
        loading={drawerQuery.isLoading}
        errorMessage={
          drawerQuery.isError ? permissionDeniedMessage(drawerQuery.error) : null
        }
        onClose={() => replaceFilters({ review: null })}
      />
    </div>
  );
}
