"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { tourismPath } from "@/src/lib/dashboardPaths";

import {
  getAdminTourismResearch,
  markAdminTourismResearchNeedsResearch,
  markAdminTourismResearchRejected,
  markAdminTourismResearchReviewing,
} from "./api";
import { tourismNewFormFromResearch } from "./researchEditorNav";
import { entityTypeLabel, researchStatusLabel } from "./types";

const PRIMARY_BTN =
  "rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50";
const SECONDARY_BTN =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const DANGER_BTN =
  "rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-50 disabled:opacity-50";

export default function TourismResearchDetailPage({
  candidateId,
}: {
  candidateId: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["tourism-research", "detail", candidateId],
    queryFn: ({ signal }) => getAdminTourismResearch(candidateId, { signal }),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["tourism-research", "detail", candidateId] });
    await queryClient.invalidateQueries({ queryKey: ["tourism-research", "list"] });
  };

  const rejectMutation = useMutation({
    mutationFn: () => markAdminTourismResearchRejected(candidateId),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof Error ? err.message : "Reject failed"),
  });

  const needsResearchMutation = useMutation({
    mutationFn: () => markAdminTourismResearchNeedsResearch(candidateId),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof Error ? err.message : "Update failed"),
  });

  const reviewAndAddMutation = useMutation({
    mutationFn: async () => {
      const row = detailQuery.data;
      if (!row) throw new Error("Candidate not loaded");
      await markAdminTourismResearchReviewing(candidateId);
      const href = tourismNewFormFromResearch(row.entity_type, candidateId);
      if (!href) {
        throw new Error(`No editor form for entity type "${row.entity_type}"`);
      }
      return href;
    },
    onSuccess: async (href) => {
      await invalidate();
      router.push(href);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Review and add failed"),
  });

  const row = detailQuery.data;
  const canReviewAndAdd =
    row &&
    row.research_status !== "added" &&
    row.research_status !== "rejected" &&
    tourismNewFormFromResearch(row.entity_type, candidateId) != null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div>
        <Link href={tourismPath("research")} className="text-sm text-gray-600 hover:underline">
          Back to research
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">
          {row?.name ?? "Research candidate"}
        </h1>
      </div>

      {detailQuery.isError ? (
        <p className="text-sm text-red-700">Candidate not found or failed to load.</p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {row ? (
        <>
          <div className="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-700">
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase text-gray-500">Entity type</dt>
                <dd>{entityTypeLabel(row.entity_type)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-gray-500">Status</dt>
                <dd>{researchStatusLabel(row.research_status)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-gray-500">Township</dt>
                <dd>{row.admin_area_name}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-gray-500">Confidence</dt>
                <dd>{row.evidence_confidence ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-gray-500">Provider</dt>
                <dd>{row.research_provider}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-gray-500">Researched</dt>
                <dd>{new Date(row.researched_at).toLocaleString()}</dd>
              </div>
              {row.created_entity_public_id ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs uppercase text-gray-500">Created entity</dt>
                  <dd>
                    {row.created_entity_type} — {row.created_entity_public_id}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>

          <section className="rounded-md border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-900">Evidence</h2>
            {row.evidence.short_description || row.evidence.description ? (
              <p className="mt-2 text-sm text-gray-700">
                {row.evidence.short_description ?? row.evidence.description}
              </p>
            ) : (
              <p className="mt-2 text-sm text-gray-500">No description in payload.</p>
            )}
            {row.evidence.uncertainties.length > 0 ? (
              <div className="mt-3">
                <h3 className="text-xs font-medium uppercase text-gray-500">Uncertainties</h3>
                <ul className="mt-1 list-inside list-disc text-sm text-gray-700">
                  {row.evidence.uncertainties.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {row.evidence.conflicts.length > 0 ? (
              <div className="mt-3">
                <h3 className="text-xs font-medium uppercase text-gray-500">Conflicts</h3>
                <ul className="mt-1 list-inside list-disc text-sm text-gray-700">
                  {row.evidence.conflicts.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {row.evidence.sources.length > 0 ? (
              <div className="mt-3">
                <h3 className="text-xs font-medium uppercase text-gray-500">Sources</h3>
                <ul className="mt-1 space-y-1 text-sm">
                  {row.evidence.sources.map((source, i) => {
                    const url = typeof source.url === "string" ? source.url : null;
                    const title =
                      typeof source.title === "string" ? source.title : url ?? `Source ${i + 1}`;
                    return (
                      <li key={`${url ?? i}`}>
                        {url ? (
                          <a
                            href={url}
                            className="text-gray-900 underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {title}
                          </a>
                        ) : (
                          title
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {row.evidence.notes ? (
              <p className="mt-3 text-sm text-gray-600">{row.evidence.notes}</p>
            ) : null}
          </section>

          <div className="flex flex-wrap gap-2">
            {canReviewAndAdd ? (
              <button
                type="button"
                className={PRIMARY_BTN}
                disabled={reviewAndAddMutation.isPending}
                onClick={() => {
                  setError(null);
                  reviewAndAddMutation.mutate();
                }}
              >
                {reviewAndAddMutation.isPending ? "Opening form…" : "Review and add"}
              </button>
            ) : null}
            {row.research_status !== "added" && row.research_status !== "rejected" ? (
              <>
                <button
                  type="button"
                  className={SECONDARY_BTN}
                  disabled={needsResearchMutation.isPending}
                  onClick={() => {
                    setError(null);
                    needsResearchMutation.mutate();
                  }}
                >
                  Needs more research
                </button>
                <button
                  type="button"
                  className={DANGER_BTN}
                  disabled={rejectMutation.isPending}
                  onClick={() => {
                    setError(null);
                    rejectMutation.mutate();
                  }}
                >
                  Reject
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : detailQuery.isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : null}
    </div>
  );
}
