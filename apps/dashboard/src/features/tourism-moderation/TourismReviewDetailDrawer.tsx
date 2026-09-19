"use client";

import Link from "next/link";

import ReviewDetailDrawer from "@/src/components/review/ReviewDetailDrawer";
import { reviewsPath, usersPath } from "@/src/lib/dashboardPaths";

import {
  formatDateTime,
  previewText,
  tourismHistoryLabel,
  tourismStatusBadgeClass,
  tourismStatusLabel,
} from "./constants";
import type { TourismReviewDetail } from "./types";

type TourismReviewDetailDrawerProps = {
  readonly open: boolean;
  readonly detail: TourismReviewDetail | null;
  readonly loading?: boolean;
  readonly errorMessage?: string | null;
  readonly onClose: () => void;
};

export function TourismReviewDetailDrawer({
  open,
  detail,
  loading = false,
  errorMessage = null,
  onClose,
}: TourismReviewDetailDrawerProps) {
  if (!open) return null;

  if (loading || !detail) {
    return (
      <ReviewDetailDrawer
        title="Review"
        onClose={onClose}
        ariaLabel="Place review details"
        palette="core"
      >
        {errorMessage ? (
          <p className="text-sm text-red-700">{errorMessage}</p>
        ) : (
          <p className="text-sm text-slate-500">Loading review…</p>
        )}
      </ReviewDetailDrawer>
    );
  }

  return (
    <ReviewDetailDrawer
      title={detail.title?.trim() || `Rating ${detail.rating}/5`}
      subtitle={detail.author.display_name}
      onClose={onClose}
      ariaLabel="Place review details"
      palette="core"
      maxWidthClass="sm:max-w-2xl"
      actions={
        <Link
          href={reviewsPath(detail.public_id)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Full page
        </Link>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${tourismStatusBadgeClass(detail.status)}`}
          >
            {tourismStatusLabel(detail.status)}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
            {detail.rating}/5
          </span>
        </div>

        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Author</dt>
            <dd className="mt-0.5">
              <Link
                href={usersPath(detail.author.public_id)}
                className="font-medium text-slate-900 hover:underline"
              >
                {detail.author.display_name}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Place</dt>
            <dd className="mt-0.5 font-mono text-xs text-slate-700">{detail.place_public_id}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Content</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-slate-800">
              {previewText(detail.body, 2000)}
            </dd>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Created</dt>
              <dd className="mt-0.5 text-slate-700">{formatDateTime(detail.created_at)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Updated</dt>
              <dd className="mt-0.5 text-slate-700">{formatDateTime(detail.updated_at)}</dd>
            </div>
          </div>
        </dl>

        <ModerationHistoryList events={detail.moderation_history} />
      </div>
    </ReviewDetailDrawer>
  );
}

export function ModerationHistoryList({
  events,
}: {
  readonly events: TourismReviewDetail["moderation_history"];
}) {
  if (!events || events.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Moderation history</h3>
        <p className="mt-1 text-sm text-slate-500">No moderation events yet.</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">Moderation history</h3>
      <ol className="mt-2 space-y-2">
        {events.map((event, index) => (
          <li
            key={`${event.created_at}-${index}`}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
          >
            <p className="font-medium text-slate-900">
              {tourismHistoryLabel(event.from_status, event.to_status)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {formatDateTime(event.created_at)}
              {event.actor ? ` · ${event.actor.display_name}` : ""}
            </p>
            {event.note ? (
              <p className="mt-1 text-slate-700">{event.note}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
