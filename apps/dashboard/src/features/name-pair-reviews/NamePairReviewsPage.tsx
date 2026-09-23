"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import {
  approveNamePairReview,
  getNamePairSummary,
  listNamePairGaps,
  listNamePairReviews,
  rejectNamePairReview,
  skipNamePairReview,
} from "./api";
import { formatCount, formatEntityTypeLabel, namePairDetailHref } from "./detailHref";
import type { NamePairBucket, NamePairReviewItem } from "./types";
import { NAME_PAIR_REASON_AUTO_APPLIED } from "./types";

const SELECT =
  "h-9 rounded-md border border-gray-300 bg-white px-2.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const BTN =
  "inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-gray-900 text-white hover:bg-gray-800`;
const BTN_SECONDARY = `${BTN} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`;
const PAGE_SIZE = 20;

const REASON_FILTERS = [
  { id: "", label: "All reasons" },
  { id: NAME_PAIR_REASON_AUTO_APPLIED, label: "AI / auto applied" },
  { id: "__other__", label: "Important / uncertain" },
] as const;

const BUCKETS: {
  id: NamePairBucket;
  label: string;
  hint: string;
}[] = [
  {
    id: "review",
    label: "Review candidates",
    hint: "Important or uncertain fills awaiting approve / edit",
  },
  {
    id: "remain_non_street",
    label: "Remaining non-street",
    hint: "Gaps left after auto-fill (not queued for review)",
  },
  {
    id: "remain_minor_streets",
    label: "Minor Latin streets",
    hint: "EN-only local roads left as language-mode fallback",
  },
];

export default function NamePairReviewsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const bucket = (searchParams.get("bucket")?.trim() || "review") as NamePairBucket;
  const status = searchParams.get("status")?.trim() || "pending";
  const entityType = searchParams.get("entity_type")?.trim() || "";
  const reason = searchParams.get("reason")?.trim() || "";
  const q = searchParams.get("q")?.trim() || "";
  const offset = Number(searchParams.get("offset") || "0") || 0;
  const [searchDraft, setSearchDraft] = useState(q);
  const [editing, setEditing] = useState<NamePairReviewItem | null>(null);
  const [editMm, setEditMm] = useState("");
  const [editEn, setEditEn] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

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

  const summaryQuery = useQuery({
    queryKey: ["name-pair-reviews", "summary"],
    queryFn: ({ signal }) => getNamePairSummary({ signal }),
    staleTime: 15_000,
    refetchInterval: (query) =>
      query.state.data?.remain_status === "computing" ? 5_000 : false,
  });

  const summary = summaryQuery.data;
  const remainReady = summary?.remain_status === "ready";
  const remainComputing = summary?.remain_status === "computing";
  const remainError = summary?.remain_status === "error";
  const reviewSlice =
    bucket === "review"
      ? reason === NAME_PAIR_REASON_AUTO_APPLIED
        ? summary?.review.auto_applied
        : reason === "__other__"
          ? summary?.review.other
          : summary?.review
      : undefined;
  const activeBucketSummary =
    bucket === "review"
      ? reviewSlice
      : bucket === "remain_non_street"
        ? summary?.remain_non_street
        : summary?.remain_minor_streets;

  const entityCounts = activeBucketSummary?.by_entity ?? {};
  const entityOptions = useMemo(() => {
    const keys = Object.keys(entityCounts).sort();
    if (bucket === "remain_minor_streets") return ["street"];
    if (bucket === "remain_non_street") {
      return [
        "place",
        "settlement",
        "admin_area",
        "building",
        "transport_stop",
        "transport_terminal",
      ];
    }
    return keys.length
      ? keys
      : [
          "place",
          "settlement",
          "admin_area",
          "street",
          "building",
          "transport_stop",
          "transport_terminal",
        ];
  }, [bucket, entityCounts]);

  const effectiveEntity =
    bucket === "remain_minor_streets"
      ? "street"
      : entityType || (bucket === "remain_non_street" ? entityOptions[0] || "place" : "");

  const reviewFilters = useMemo(() => {
    const base: {
      status: string;
      entity_type?: string;
      reason?: string;
      exclude_reason?: string;
      q?: string;
      limit: number;
      offset: number;
    } = {
      status,
      entity_type: entityType || undefined,
      q: q || undefined,
      limit: PAGE_SIZE,
      offset,
    };
    if (reason === NAME_PAIR_REASON_AUTO_APPLIED) {
      base.reason = NAME_PAIR_REASON_AUTO_APPLIED;
    } else if (reason === "__other__") {
      base.exclude_reason = NAME_PAIR_REASON_AUTO_APPLIED;
    }
    return base;
  }, [status, entityType, reason, q, offset]);

  const gapFilters = useMemo(
    () => ({
      bucket: bucket as "remain_non_street" | "remain_minor_streets",
      entity_type: effectiveEntity || undefined,
      q: q || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [bucket, effectiveEntity, q, offset],
  );

  const reviewQuery = useQuery({
    queryKey: ["name-pair-reviews", "list", reviewFilters],
    queryFn: ({ signal }) => listNamePairReviews(reviewFilters, { signal }),
    enabled: bucket === "review",
    placeholderData: keepPreviousData,
  });

  const gapsQuery = useQuery({
    queryKey: ["name-pair-reviews", "gaps", gapFilters],
    queryFn: ({ signal }) => listNamePairGaps(gapFilters, { signal }),
    enabled: bucket !== "review",
    placeholderData: keepPreviousData,
  });

  const listLoading = bucket === "review" ? reviewQuery.isLoading : gapsQuery.isLoading;
  const total = bucket === "review" ? (reviewQuery.data?.total ?? 0) : (gapsQuery.data?.total ?? 0);
  const reviewItems = reviewQuery.data?.items ?? [];
  const gapItems = gapsQuery.data?.items ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["name-pair-reviews"] });
  };

  const approveMutation = useMutation({
    mutationFn: (args: {
      publicId: string;
      proposed_mm?: string | null;
      proposed_en?: string | null;
    }) =>
      approveNamePairReview(args.publicId, {
        proposed_mm: args.proposed_mm,
        proposed_en: args.proposed_en,
      }),
    onSuccess: () => {
      setFlash("Approved and applied.");
      setEditing(null);
      invalidate();
    },
    onError: (error: Error) => setFlash(error.message || "Approve failed"),
  });

  const rejectMutation = useMutation({
    mutationFn: (publicId: string) => rejectNamePairReview(publicId),
    onSuccess: () => {
      setFlash("Rejected.");
      invalidate();
    },
    onError: (error: Error) => setFlash(error.message || "Reject failed"),
  });

  const skipMutation = useMutation({
    mutationFn: (publicId: string) => skipNamePairReview(publicId),
    onSuccess: () => {
      setFlash("Skipped.");
      invalidate();
    },
    onError: (error: Error) => setFlash(error.message || "Skip failed"),
  });

  const busy =
    approveMutation.isPending || rejectMutation.isPending || skipMutation.isPending;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Name pairs</h1>
        <p className="mt-1 text-sm text-gray-600">
          Filter by repair bucket, reason (AI / auto applied vs important), then entity
          type. Approve keeps or edits names; reject removes bad AI transliterations.
        </p>
      </div>

      {flash ? (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">
          {flash}
        </p>
      ) : null}

      {summaryQuery.isError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Could not load bucket counts.{" "}
          {(summaryQuery.error as Error)?.message || "Retry in a moment."}
        </p>
      ) : null}

      {remainComputing ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Non-street totals load first. Place and minor-street totals finish in the
          background (chunked nationwide scans) and will fill in when ready.
        </p>
      ) : null}

      {remainError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Place / street total scan failed. Review and other remain counts still work.
          Refresh the page to retry the heavy scan.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {BUCKETS.map((b) => {
          const count =
            b.id === "review"
              ? summary?.review.total
              : b.id === "remain_non_street"
                ? summary?.remain_non_street.total
                : summary?.remain_minor_streets.total;
          const active = bucket === b.id;
          const showLoading =
            summaryQuery.isLoading ||
            (b.id === "remain_minor_streets" &&
              remainComputing &&
              !remainReady &&
              (count ?? 0) === 0);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() =>
                replaceFilters({
                  bucket: b.id,
                  entity_type: b.id === "remain_minor_streets" ? "street" : null,
                  status: b.id === "review" ? status : null,
                })
              }
              className={`rounded-lg border px-4 py-3 text-left transition ${
                active
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-200 bg-white text-gray-900 hover:border-gray-400"
              }`}
            >
              <div className="text-xs font-medium uppercase tracking-wide opacity-80">
                {b.label}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {showLoading
                  ? "…"
                  : summaryQuery.isError
                    ? "—"
                    : formatCount(count ?? 0)}
              </div>
              <div className={`mt-1 text-xs ${active ? "text-gray-300" : "text-gray-500"}`}>
                {b.hint}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {bucket === "review" ? (
          <button
            type="button"
            className={`${BTN} ${!entityType ? BTN_PRIMARY : BTN_SECONDARY}`}
            onClick={() => replaceFilters({ entity_type: null })}
          >
            All
            {summary && !summaryQuery.isError
              ? ` · ${formatCount(activeBucketSummary?.total ?? summary.review.total)}`
              : ""}
          </button>
        ) : null}
        {entityOptions.map((et) => {
          const count = entityCounts[et];
          const active =
            bucket === "remain_minor_streets" ||
            effectiveEntity === et ||
            (bucket === "review" && entityType === et);
          const showCount =
            bucket === "review"
              ? typeof count === "number" && !summaryQuery.isError
              : typeof count === "number" &&
                !summaryQuery.isError &&
                (bucket !== "remain_minor_streets" || remainReady || (count ?? 0) > 0);
          return (
            <button
              key={et}
              type="button"
              className={`${BTN} ${active ? BTN_PRIMARY : BTN_SECONDARY}`}
              onClick={() => replaceFilters({ entity_type: et })}
            >
              {formatEntityTypeLabel(et)}
              {showCount
                ? ` · ${formatCount(count)}`
                : bucket === "remain_minor_streets" && remainComputing
                  ? " · …"
                  : typeof count === "number" && et === "place" && remainComputing
                    ? " · …"
                    : ""}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {bucket === "review" ? (
          <>
            <select
              className={SELECT}
              value={status}
              onChange={(e) => replaceFilters({ status: e.target.value })}
              aria-label="Status"
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="skipped">Skipped</option>
            </select>
            <select
              className={SELECT}
              value={reason}
              onChange={(e) => replaceFilters({ reason: e.target.value || null })}
              aria-label="Reason"
            >
              {REASON_FILTERS.map((r) => {
                const count =
                  r.id === NAME_PAIR_REASON_AUTO_APPLIED
                    ? summary?.review.auto_applied?.total
                    : r.id === "__other__"
                      ? summary?.review.other?.total
                      : summary?.review.total;
                return (
                  <option key={r.id || "all"} value={r.id}>
                    {r.label}
                    {typeof count === "number" ? ` (${formatCount(count)})` : ""}
                  </option>
                );
              })}
            </select>
          </>
        ) : null}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            replaceFilters({ q: searchDraft.trim() || null });
          }}
        >
          <input
            className={`${SELECT} w-64`}
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search name"
          />
          <button type="submit" className={BTN_SECONDARY}>
            Search
          </button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2.5">Entity</th>
              <th className="px-3 py-2.5">Source</th>
              <th className="px-3 py-2.5">MM</th>
              <th className="px-3 py-2.5">EN</th>
              {bucket === "review" ? <th className="px-3 py-2.5">Conf</th> : null}
              <th className="px-3 py-2.5">Reason</th>
              <th className="px-3 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {listLoading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : bucket === "review" ? (
              reviewItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-gray-500">
                    No review rows for this filter.
                  </td>
                </tr>
              ) : (
                reviewItems.map((item) => {
                  const href = namePairDetailHref({
                    entityType: item.entity_type,
                    entityId: item.entity_id,
                    entityPublicId: item.entity_public_id,
                  });
                  return (
                    <tr key={item.public_id}>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <div className="font-medium text-gray-900">
                          {formatEntityTypeLabel(item.entity_type)}
                        </div>
                        <div className="text-xs text-gray-500">{item.direction}</div>
                      </td>
                      <td className="max-w-[14rem] px-3 py-2.5 break-words text-gray-800">
                        {item.source_name}
                      </td>
                      <td className="max-w-[10rem] px-3 py-2.5 break-words text-gray-800">
                        {item.proposed_mm ?? "—"}
                      </td>
                      <td className="max-w-[10rem] px-3 py-2.5 break-words text-gray-800">
                        {item.proposed_en ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-gray-700">
                        {item.confidence}
                      </td>
                      <td className="max-w-[12rem] px-3 py-2.5 break-words text-xs text-gray-500">
                        {item.reason}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1.5">
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className={BTN_SECONDARY}
                            >
                              Open
                            </a>
                          ) : null}
                          {item.status === "pending" ? (
                            <>
                              <button
                                type="button"
                                className={BTN_PRIMARY}
                                disabled={busy}
                                onClick={() =>
                                  approveMutation.mutate({
                                    publicId: item.public_id,
                                    proposed_mm: item.proposed_mm,
                                    proposed_en: item.proposed_en,
                                  })
                                }
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className={BTN_SECONDARY}
                                disabled={busy}
                                onClick={() => {
                                  setEditing(item);
                                  setEditMm(item.proposed_mm ?? "");
                                  setEditEn(item.proposed_en ?? "");
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className={BTN_SECONDARY}
                                disabled={busy}
                                onClick={() => rejectMutation.mutate(item.public_id)}
                              >
                                Reject
                              </button>
                              <button
                                type="button"
                                className={BTN_SECONDARY}
                                disabled={busy}
                                onClick={() => skipMutation.mutate(item.public_id)}
                              >
                                Skip
                              </button>
                            </>
                          ) : (
                            <span className="text-xs text-gray-500">{item.status}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )
            ) : gapItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-gray-500">
                  No remaining gaps for this filter.
                </td>
              </tr>
            ) : (
              gapItems.map((item) => {
                const href = namePairDetailHref({
                  entityType: item.entity_type,
                  entityId: item.entity_id,
                  entityPublicId: item.entity_public_id,
                });
                return (
                  <tr key={`${item.entity_type}-${item.entity_id}`}>
                    <td className="whitespace-nowrap px-3 py-2.5 font-medium text-gray-900">
                      {formatEntityTypeLabel(item.entity_type)}
                    </td>
                    <td className="max-w-[14rem] px-3 py-2.5 break-words text-gray-800">
                      {item.source_name}
                    </td>
                    <td className="max-w-[10rem] px-3 py-2.5 break-words text-gray-800">
                      {item.name_mm ?? "—"}
                    </td>
                    <td className="max-w-[10rem] px-3 py-2.5 break-words text-gray-800">
                      {item.name_en ?? "—"}
                    </td>
                    <td className="max-w-[12rem] px-3 py-2.5 break-words text-xs text-gray-500">
                      {item.gap_reason}
                    </td>
                    <td className="px-3 py-2.5">
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className={BTN_SECONDARY}
                        >
                          Open detail
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">No detail link</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>
          {formatCount(total)} in filter
          {total > 0
            ? ` · showing ${formatCount(offset + 1)}–${formatCount(Math.min(offset + PAGE_SIZE, total))}`
            : ""}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className={BTN_SECONDARY}
            disabled={offset <= 0}
            onClick={() =>
              replaceFilters({ offset: String(Math.max(0, offset - PAGE_SIZE)) })
            }
          >
            Previous
          </button>
          <button
            type="button"
            className={BTN_SECONDARY}
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => replaceFilters({ offset: String(offset + PAGE_SIZE) })}
          >
            Next
          </button>
        </div>
      </div>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-4 shadow-lg">
            <h2 className="text-base font-semibold text-gray-900">Edit then approve</h2>
            <p className="mt-1 text-xs text-gray-500">{editing.source_name}</p>
            <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-gray-600">
              Proposed MM
              <input
                className={SELECT}
                value={editMm}
                onChange={(e) => setEditMm(e.target.value)}
              />
            </label>
            <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-gray-600">
              Proposed EN
              <input
                className={SELECT}
                value={editEn}
                onChange={(e) => setEditEn(e.target.value)}
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={BTN_SECONDARY} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={BTN_PRIMARY}
                disabled={busy || (!editMm.trim() && !editEn.trim())}
                onClick={() =>
                  approveMutation.mutate({
                    publicId: editing.public_id,
                    proposed_mm: editMm.trim() || null,
                    proposed_en: editEn.trim() || null,
                  })
                }
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
