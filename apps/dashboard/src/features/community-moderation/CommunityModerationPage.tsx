"use client";

import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import StatsCard from "@/src/components/dashboard/StatsCard";
import { communityPath, usersPath } from "@/src/lib/dashboardPaths";

import { getCommunityModerationCounts, listCommunityModerationPosts } from "./api";
import { contextualListActionLabel } from "./availableActions";
import {
  COMMUNITY_CATEGORIES,
  categoryLabel,
  formatDateTime,
  publicationBadgeClass,
  publicationLabel,
  totalReactionCount,
  verificationBadgeClass,
  verificationLabel,
} from "./constants";
import type {
  CommunityClosedStatusFilter,
  CommunityLiveVerificationFilter,
  CommunityQueueView,
} from "./types";

const PAGE_SIZE = 25;

const VIEWS: readonly { id: CommunityQueueView; label: string; countKey: keyof Counts }[] = [
  { id: "needs_review", label: "Needs Review", countKey: "needs_review" },
  { id: "live", label: "Live Posts", countKey: "live" },
  { id: "trusted", label: "Trusted", countKey: "trusted" },
  { id: "closed", label: "Closed", countKey: "closed" },
];

type Counts = {
  needs_review: number;
  live: number;
  trusted: number;
  closed: number;
};

const LIVE_VERIFICATION_OPTIONS: readonly {
  id: CommunityLiveVerificationFilter;
  label: string;
}[] = [
  { id: "all", label: "All" },
  { id: "unverified", label: "Unverified" },
  { id: "community_confirmed", label: "Community Confirmed" },
  { id: "admin_verified", label: "CoreMap Verified" },
];

const CLOSED_STATUS_OPTIONS: readonly {
  id: CommunityClosedStatusFilter;
  label: string;
}[] = [
  { id: "all", label: "All" },
  { id: "resolved", label: "Resolved" },
  { id: "expired", label: "Expired" },
  { id: "rejected", label: "Rejected" },
  { id: "removed", label: "Removed" },
];

const SELECT_CLASS =
  "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const SECONDARY_BTN =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_BTN =
  "inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50";

function parseView(value: string | null): CommunityQueueView {
  if (value === "live" || value === "trusted" || value === "closed" || value === "needs_review") {
    return value;
  }
  return "needs_review";
}

function parseLiveVerification(value: string | null): CommunityLiveVerificationFilter {
  if (
    value === "unverified" ||
    value === "community_confirmed" ||
    value === "admin_verified" ||
    value === "all"
  ) {
    return value;
  }
  return "all";
}

function parseClosedStatus(value: string | null): CommunityClosedStatusFilter {
  if (
    value === "resolved" ||
    value === "expired" ||
    value === "rejected" ||
    value === "removed" ||
    value === "all"
  ) {
    return value;
  }
  return "all";
}

function formatCount(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString();
}

export default function CommunityModerationPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const view = parseView(searchParams.get("view"));
  const liveVerification = parseLiveVerification(searchParams.get("verification"));
  const closedStatus = parseClosedStatus(searchParams.get("closedStatus"));
  const category = searchParams.get("category")?.trim() ?? "";
  const search = searchParams.get("q")?.trim() ?? "";

  const [searchDraft, setSearchDraft] = useState(search);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const pageIndex = cursorStack.length - 1;
  const cursor = cursorStack[pageIndex] ?? null;

  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  useEffect(() => {
    setCursorStack([null]);
  }, [view, liveVerification, closedStatus, category, search]);

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
      view,
      category: category || undefined,
      search: search || undefined,
      liveVerification,
      closedStatus,
      cursor: cursor ?? undefined,
      limit: PAGE_SIZE,
    }),
    [view, category, search, liveVerification, closedStatus, cursor],
  );

  const countsQuery = useQuery({
    queryKey: ["community-moderation", "counts"],
    queryFn: ({ signal }) => getCommunityModerationCounts({ signal }),
  });

  const query = useQuery({
    queryKey: ["community-moderation", "list", listFilters],
    queryFn: ({ signal }) => listCommunityModerationPosts(listFilters, { signal }),
    placeholderData: keepPreviousData,
  });

  const items = query.data?.items ?? [];
  const nextCursor = query.data?.next_cursor ?? null;
  const counts = countsQuery.data;

  const emptyState = useMemo(() => {
    if (view === "needs_review") {
      return {
        message:
          "No live unverified posts need review. New community posts appear here immediately after publication.",
        actionLabel: "View Live Posts",
        action: () => replaceFilters({ view: "live", verification: null, closedStatus: null }),
      };
    }
    if (view === "trusted") {
      return {
        message:
          "No trusted posts yet. Posts appear here after community confirmation or CoreMap verification.",
        actionLabel: null,
        action: null,
      };
    }
    if (view === "closed") {
      return {
        message: "No closed posts found.",
        actionLabel: null,
        action: null,
      };
    }
    return {
      message: "No live posts match these filters.",
      actionLabel: null,
      action: null,
    };
  }, [replaceFilters, view]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Community Posts</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Review and manage publicly visible community posts. New posts are published immediately.
          </p>
        </div>
        <button
          type="button"
          className={SECONDARY_BTN}
          disabled={query.isFetching || countsQuery.isFetching}
          onClick={() => {
            void query.refetch();
            void countsQuery.refetch();
          }}
        >
          <RefreshCw
            className={`h-4 w-4 ${query.isFetching || countsQuery.isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatsCard
          title="Needs Review"
          value={counts?.needs_review ?? "—"}
          description="Published + unverified"
          statusColor={(counts?.needs_review ?? 0) > 0 ? "warning" : "default"}
        />
        <StatsCard
          title="Live Posts"
          value={counts?.live ?? "—"}
          description="Currently published"
        />
        <StatsCard
          title="Trusted"
          value={counts?.trusted ?? "—"}
          description="Community or CoreMap verified"
          statusColor="success"
        />
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
        {VIEWS.map((item) => {
          const active = view === item.id;
          const count = counts?.[item.countKey];
          return (
            <button
              key={item.id}
              type="button"
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
              onClick={() =>
                replaceFilters({
                  view: item.id,
                  verification:
                    item.id === "live" && liveVerification !== "all" ? liveVerification : null,
                  closedStatus:
                    item.id === "closed" && closedStatus !== "all" ? closedStatus : null,
                })
              }
            >
              <span>{item.label}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                  active ? "bg-white/15 text-white" : "bg-gray-100 text-gray-700"
                }`}
              >
                {formatCount(count)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <label className="min-w-[14rem] flex-1 space-y-1 text-sm">
          <span className="font-medium text-gray-700">Search</span>
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                replaceFilters({ q: searchDraft.trim() || null });
              }
            }}
            placeholder="Title, content, or author"
            className="block w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium text-gray-700">Category</span>
          <select
            value={category}
            onChange={(e) => replaceFilters({ category: e.target.value || null })}
            className={`block w-52 ${SELECT_CLASS}`}
          >
            <option value="">All categories</option>
            {COMMUNITY_CATEGORIES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {view === "live" ? (
          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700">Verification</span>
            <select
              value={liveVerification}
              onChange={(e) =>
                replaceFilters({
                  verification: e.target.value === "all" ? null : e.target.value,
                })
              }
              className={`block w-52 ${SELECT_CLASS}`}
            >
              {LIVE_VERIFICATION_OPTIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {view === "closed" ? (
          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700">Closed status</span>
            <select
              value={closedStatus}
              onChange={(e) =>
                replaceFilters({
                  closedStatus: e.target.value === "all" ? null : e.target.value,
                })
              }
              className={`block w-44 ${SELECT_CLASS}`}
            >
              {CLOSED_STATUS_OPTIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className={PRIMARY_BTN}
          onClick={() => replaceFilters({ q: searchDraft.trim() || null })}
        >
          Apply
        </button>
        {(search || category || liveVerification !== "all" || closedStatus !== "all") && (
          <button
            type="button"
            className={SECONDARY_BTN}
            onClick={() =>
              replaceFilters({
                q: null,
                category: null,
                verification: null,
                closedStatus: null,
              })
            }
          >
            Clear
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            {VIEWS.find((item) => item.id === view)?.label ?? "Community Posts"}
          </h2>
        </div>

        {query.isLoading ? (
          <p className="p-6 text-sm text-gray-500">Loading posts…</p>
        ) : query.isError ? (
          <div className="m-4 space-y-3 rounded-lg border border-red-100 bg-red-50 p-4">
            <p className="text-sm text-red-700">Community posts queue unavailable.</p>
            <button type="button" className={SECONDARY_BTN} onClick={() => void query.refetch()}>
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="space-y-3 p-6">
            <p className="text-sm text-gray-600">{emptyState.message}</p>
            {emptyState.actionLabel && emptyState.action ? (
              <button type="button" className={PRIMARY_BTN} onClick={emptyState.action}>
                {emptyState.actionLabel}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
              <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Post</th>
                  <th className="px-4 py-3">Author</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Trust</th>
                  <th className="px-4 py-3">Activity</th>
                  <th className="px-4 py-3">Published</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((post) => {
                  const actionLabel = contextualListActionLabel({
                    publicationStatus: post.publication_status,
                    verificationStatus: post.verification_status,
                  });
                  return (
                    <tr key={post.public_id} className="hover:bg-gray-50/80">
                      <td className="max-w-md px-4 py-3">
                        <Link
                          href={communityPath(post.public_id)}
                          className="font-medium text-gray-900 hover:underline"
                        >
                          {post.title}
                        </Link>
                        <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                          {post.description_preview}
                        </p>
                        <p className="mt-1 text-xs font-medium text-gray-600">
                          {categoryLabel(post.category)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={usersPath(post.author.public_id)}
                          className="text-gray-700 hover:underline"
                        >
                          {post.author.display_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${publicationBadgeClass(post.publication_status)}`}
                          >
                            {publicationLabel(post.publication_status)}
                          </span>
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${verificationBadgeClass(post.verification_status)}`}
                          >
                            {verificationLabel(post.verification_status)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-gray-700">{post.trust_score}</td>
                      <td className="px-4 py-3 tabular-nums text-gray-700">
                        {totalReactionCount(post.reaction_counts)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {formatDateTime(post.published_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={communityPath(post.public_id)}
                          className="text-sm font-medium text-blue-700 hover:underline"
                        >
                          {actionLabel}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            className={SECONDARY_BTN}
            disabled={pageIndex === 0 || query.isFetching}
            onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
          >
            Previous
          </button>
          <span className="text-xs text-gray-500">Page {pageIndex + 1}</span>
          <button
            type="button"
            className={SECONDARY_BTN}
            disabled={!nextCursor || query.isFetching}
            onClick={() => {
              if (!nextCursor) return;
              setCursorStack((stack) => [...stack, nextCursor]);
            }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
