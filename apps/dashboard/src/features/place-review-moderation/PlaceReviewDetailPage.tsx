"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { reviewsPath, tourismPath, usersPath } from "@/src/lib/dashboardPaths";

import {
  getAdminPlaceReview,
  moderatePlaceReview,
} from "@/src/features/place-review-moderation/api";
import {
  availableTourismActions,
  primaryTourismAction,
  secondaryTourismActions,
} from "./availableActions";
import {
  formatDateTime,
  tourismModerationActionLabel,
  tourismStatusBadgeClass,
  tourismStatusLabel,
} from "./constants";
import { permissionDeniedMessage } from "./filters";
import { PlaceReviewModerationDialog } from "./PlaceReviewModerationDialog";
import { ModerationHistoryList } from "./PlaceReviewDetailDrawer";
import type { PlaceReviewModerationAction } from "./types";

const SECONDARY_BTN =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_BTN =
  "inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50";
const DANGER_BTN =
  "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50";

export default function PlaceReviewDetailPage({
  publicId,
}: {
  readonly publicId: string;
}) {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<PlaceReviewModerationAction | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["tourism-moderation", "detail", publicId],
    queryFn: ({ signal }) => getAdminPlaceReview(publicId, { signal }),
  });

  const moderateMutation = useMutation({
    mutationFn: (input: { action: PlaceReviewModerationAction; note?: string }) =>
      moderatePlaceReview(publicId, input.action, input.note),
    onSuccess: async (_data, variables) => {
      setPendingAction(null);
      setToast(`${tourismModerationActionLabel(variables.action)} applied`);
      await queryClient.invalidateQueries({
        queryKey: ["tourism-moderation", "detail", publicId],
      });
      await queryClient.invalidateQueries({ queryKey: ["tourism-moderation", "reviews"] });
      await queryClient.invalidateQueries({
        queryKey: ["tourism-moderation", "review-drawer"],
      });
    },
  });

  if (detailQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-sm text-gray-500">Loading review…</p>
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <Link href={reviewsPath()} className="text-sm font-medium text-gray-700 hover:underline">
          ← Back to Place Reviews
        </Link>
        <p className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {permissionDeniedMessage(detailQuery.error)}
        </p>
      </div>
    );
  }

  const review = detailQuery.data;
  const actions = availableTourismActions({ status: review.status });
  const primary = primaryTourismAction(actions);
  const secondary = secondaryTourismActions(actions);
  const busy = moderateMutation.isPending;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={reviewsPath()} className="text-sm font-medium text-gray-700 hover:underline">
          ← Back to Place Reviews
        </Link>
        <button
          type="button"
          className={SECONDARY_BTN}
          disabled={detailQuery.isFetching}
          onClick={() => {
            void detailQuery.refetch();
          }}
        >
          <RefreshCw className={`h-4 w-4 ${detailQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {toast ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {toast}
        </div>
      ) : null}

      {moderateMutation.isError ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {permissionDeniedMessage(moderateMutation.error)}
        </div>
      ) : null}

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap gap-1.5">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${tourismStatusBadgeClass(review.status)}`}
          >
            {tourismStatusLabel(review.status)}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
            {review.rating}/5
          </span>
        </div>

        <h1 className="mt-3 text-xl font-semibold text-gray-900">
          {review.title?.trim() || `Review · ${review.rating}/5`}
        </h1>
        {review.body ? (
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{review.body}</p>
        ) : (
          <p className="mt-2 text-sm text-gray-500">No written review body.</p>
        )}

        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Author</dt>
            <dd className="mt-1">
              <Link
                href={usersPath(review.author.public_id)}
                className="text-sm font-medium text-gray-900 hover:underline"
              >
                {review.author.display_name}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Place</dt>
            <dd className="mt-1">
              <Link
                href={tourismPath(`places/${review.place_public_id}`)}
                className="font-mono text-xs text-gray-800 hover:underline"
              >
                {review.place_public_id}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Created</dt>
            <dd className="mt-1 text-sm text-gray-700">{formatDateTime(review.created_at)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Updated</dt>
            <dd className="mt-1 text-sm text-gray-700">{formatDateTime(review.updated_at)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Published</dt>
            <dd className="mt-1 text-sm text-gray-700">{formatDateTime(review.published_at)}</dd>
          </div>
          {review.moderation_note ? (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Latest moderation note
              </dt>
              <dd className="mt-1 text-sm text-gray-700">{review.moderation_note}</dd>
            </div>
          ) : null}
        </dl>

        {review.status === "deleted" ? (
          <p className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
            This review is soft-deleted and cannot be restored from the dashboard.
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          {primary ? (
            <button
              type="button"
              className={primary === "reject" || primary === "hide" ? DANGER_BTN : PRIMARY_BTN}
              disabled={busy}
              onClick={() => setPendingAction(primary)}
            >
              {tourismModerationActionLabel(primary)}
            </button>
          ) : null}
          {secondary.map((action) => (
            <button
              key={action}
              type="button"
              className={action === "reject" || action === "hide" ? DANGER_BTN : SECONDARY_BTN}
              disabled={busy}
              onClick={() => setPendingAction(action)}
            >
              {tourismModerationActionLabel(action)}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <ModerationHistoryList events={review.moderation_history} />
      </section>

      <PlaceReviewModerationDialog
        open={pendingAction !== null}
        action={pendingAction}
        reviewLabel={review.title?.trim() || `rating ${review.rating}/5`}
        isBusy={busy}
        onCancel={() => {
          if (!busy) setPendingAction(null);
        }}
        onConfirm={(note) => {
          if (!pendingAction || busy) return;
          moderateMutation.mutate({ action: pendingAction, note });
        }}
      />
    </div>
  );
}
