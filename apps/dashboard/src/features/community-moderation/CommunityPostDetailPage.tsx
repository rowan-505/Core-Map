"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { communityPath, usersPath } from "@/src/lib/dashboardPaths";

import { getCommunityModerationPost, moderateCommunityPost } from "./api";
import {
  availableCommunityActions,
  primaryCommunityAction,
  secondaryCommunityActions,
} from "./availableActions";
import { CommunityModerationDialog } from "./CommunityModerationDialog";
import {
  categoryLabel,
  formatDateTime,
  moderationActionLabel,
  moderationHistoryLabel,
  publicationBadgeClass,
  publicationLabel,
  totalReactionCount,
  verificationBadgeClass,
  verificationLabel,
} from "./constants";
import type { CommunityModerationAction } from "./types";

const SECONDARY_BTN =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_BTN =
  "inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50";
const DANGER_BTN =
  "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50";
const MENU_ITEM =
  "block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50";
const MENU_ITEM_DANGER =
  "block w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-50";

export default function CommunityPostDetailPage({ publicId }: { readonly publicId: string }) {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<CommunityModerationAction | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const detailQuery = useQuery({
    queryKey: ["community-moderation", "detail", publicId],
    queryFn: ({ signal }) => getCommunityModerationPost(publicId, { signal }),
  });

  const moderateMutation = useMutation({
    mutationFn: (input: { action: CommunityModerationAction; note?: string }) =>
      moderateCommunityPost(publicId, input.action, input.note),
    onSuccess: async (_data, variables) => {
      setPendingAction(null);
      setMoreOpen(false);
      setToast(`${moderationActionLabel(variables.action)} applied`);
      await queryClient.invalidateQueries({
        queryKey: ["community-moderation", "detail", publicId],
      });
      await queryClient.invalidateQueries({ queryKey: ["community-moderation", "list"] });
      await queryClient.invalidateQueries({ queryKey: ["community-moderation", "counts"] });
    },
  });

  useEffect(() => {
    if (!moreOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  if (detailQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-sm text-gray-500">Loading post…</p>
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <Link href={communityPath()} className="text-sm font-medium text-gray-700 hover:underline">
          ← Back to Community Posts
        </Link>
        <p className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          This community post is unavailable.
        </p>
      </div>
    );
  }

  const post = detailQuery.data;
  const actions = availableCommunityActions({
    publicationStatus: post.publication_status,
    verificationStatus: post.verification_status,
  });
  const primary = primaryCommunityAction(actions);
  const secondary = secondaryCommunityActions(actions);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={communityPath()} className="text-sm font-medium text-gray-700 hover:underline">
          ← Back to Community Posts
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
          {moderateMutation.error instanceof Error
            ? moderateMutation.error.message
            : "Moderation action failed"}
        </div>
      ) : null}

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap gap-1.5">
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
          <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200">
            {categoryLabel(post.category)}
          </span>
        </div>

        <h1 className="mt-3 text-2xl font-semibold text-gray-900">{post.title}</h1>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-800">
          {post.description}
        </p>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Trust score
            </dt>
            <dd className="mt-1 text-sm tabular-nums text-gray-900">{post.trust_score}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Reactions
            </dt>
            <dd className="mt-1 text-sm text-gray-900">
              {totalReactionCount(post.reaction_counts)} total · Confirm{" "}
              {post.reaction_counts.confirm} · Helpful {post.reaction_counts.helpful} · Incorrect{" "}
              {post.reaction_counts.incorrect}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Published
            </dt>
            <dd className="mt-1 text-sm text-gray-900">{formatDateTime(post.published_at)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Updated
            </dt>
            <dd className="mt-1 text-sm text-gray-900">{formatDateTime(post.updated_at)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Created
            </dt>
            <dd className="mt-1 text-sm text-gray-900">{formatDateTime(post.created_at)}</dd>
          </div>
          {post.location ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Location
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {post.location.label ??
                  `${post.location.lat.toFixed(5)}, ${post.location.lng.toFixed(5)}`}
                <span className="mt-0.5 block text-xs text-gray-500">
                  {post.location.lat.toFixed(5)}, {post.location.lng.toFixed(5)}
                </span>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Author</h2>
        <p className="mt-2 text-sm text-gray-800">{post.author.display_name}</p>
        <Link
          href={usersPath(post.author.public_id)}
          className="mt-2 inline-block text-sm font-medium text-blue-700 hover:underline"
        >
          Open in User Management
        </Link>
        <p className="mt-2 text-xs text-gray-500">
          Account suspension and bans stay in User Management — not in this queue.
        </p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Moderation actions</h2>
        {actions.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No moderation actions for this state.</p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {primary ? (
              <button
                type="button"
                className={
                  primary === "reject" || primary === "remove" || primary === "expire"
                    ? DANGER_BTN
                    : PRIMARY_BTN
                }
                disabled={moderateMutation.isPending}
                onClick={() => setPendingAction(primary)}
              >
                {moderationActionLabel(primary)}
              </button>
            ) : null}

            {secondary.length > 0 ? (
              <div className="relative" ref={moreRef}>
                <button
                  type="button"
                  className={SECONDARY_BTN}
                  disabled={moderateMutation.isPending}
                  aria-expanded={moreOpen}
                  aria-haspopup="menu"
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  More actions
                  <ChevronDown className="h-4 w-4" />
                </button>
                {moreOpen ? (
                  <div
                    role="menu"
                    className="absolute left-0 z-20 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                  >
                    {secondary.map((action) => (
                      <button
                        key={action}
                        type="button"
                        role="menuitem"
                        className={
                          action === "reject" || action === "remove" || action === "expire"
                            ? MENU_ITEM_DANGER
                            : MENU_ITEM
                        }
                        disabled={moderateMutation.isPending}
                        onClick={() => {
                          setMoreOpen(false);
                          setPendingAction(action);
                        }}
                      >
                        {moderationActionLabel(action)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
        <p className="mt-3 text-xs text-gray-500">
          Trust actions: Verify / Unverify. Publication actions: Resolve, Expire, Reject, Remove,
          Reopen. Reject, Expire, and Remove require a note.
        </p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Moderation history</h2>
        {post.moderation_history.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No moderation events yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {post.moderation_history.map((event) => (
              <li
                key={event.public_id}
                className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">
                    {moderationHistoryLabel(event.action_code)}
                  </p>
                  <p className="text-xs text-gray-500">{formatDateTime(event.created_at)}</p>
                </div>
                <p className="mt-1 text-xs text-gray-600">
                  {event.actor?.display_name ?? "System"}
                  {event.from_publication_status || event.to_publication_status
                    ? ` · ${event.from_publication_status ?? "—"} → ${event.to_publication_status ?? "—"}`
                    : null}
                </p>
                {event.note ? (
                  <p className="mt-1 text-sm text-gray-700">{event.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <CommunityModerationDialog
        open={pendingAction !== null}
        action={pendingAction}
        postTitle={post.title}
        isBusy={moderateMutation.isPending}
        onCancel={() => setPendingAction(null)}
        onConfirm={(note) => {
          if (!pendingAction) return;
          moderateMutation.mutate({ action: pendingAction, note });
        }}
      />
    </div>
  );
}
