"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import CorePlacePicker, {
  type CorePlaceSelection,
} from "@/src/components/tourism/CorePlacePicker";
import {
  getAdminTourismResearchPrefill,
  markAdminTourismResearchAdded,
} from "@/src/features/tourism-research/api";
import ResearchEvidenceBanner from "@/src/features/tourism-research/ResearchEvidenceBanner";
import { researchCreatedEntityType } from "@/src/features/tourism-research/researchEditorNav";
import { getAdminAreaOptions } from "@/src/lib/api";
import { tourismPath } from "@/src/lib/dashboardPaths";

import {
  createAdminTourismGuide,
  getAdminTourismGuide,
  updateAdminTourismGuide,
} from "./api";
import { TOURISM_GUIDE_TYPES } from "./types";

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const PRIMARY_BTN =
  "rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50";
const SECONDARY_BTN =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50";

function strPrefill(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export default function TourismGuideEditorPage({ guideId }: { guideId?: string }) {
  const isNew = !guideId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromResearch = searchParams.get("from_research")?.trim() || null;
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [content, setContent] = useState("");
  const [guideType, setGuideType] = useState<string>("visitor_tip");
  const [adminAreaId, setAdminAreaId] = useState("");
  const [areaQuery, setAreaQuery] = useState("");
  const [place, setPlace] = useState<CorePlaceSelection | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isVerified, setIsVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefillApplied, setPrefillApplied] = useState(false);

  const existingQuery = useQuery({
    queryKey: ["tourism-visitor", "guide", guideId],
    queryFn: ({ signal }) => getAdminTourismGuide(guideId!, { signal }),
    enabled: Boolean(guideId),
  });
  const prefillQuery = useQuery({
    queryKey: ["tourism-research", "prefill", fromResearch],
    queryFn: ({ signal }) => getAdminTourismResearchPrefill(fromResearch!, { signal }),
    enabled: isNew && Boolean(fromResearch),
  });
  const areasQuery = useQuery({
    queryKey: ["admin-area-options", "tourism-guide-editor", areaQuery],
    queryFn: () =>
      getAdminAreaOptions({ limit: 200, q: areaQuery || undefined, townshipOnly: true }),
  });

  useEffect(() => {
    const row = existingQuery.data;
    if (!row) return;
    setTitle(row.title);
    setShortDescription(row.short_description ?? "");
    setContent(row.content);
    setGuideType(row.guide_type);
    setAdminAreaId(row.admin_area_id);
    setPlace(
      row.place_public_id
        ? { public_id: row.place_public_id, display_name: row.place_name ?? row.place_public_id }
        : null,
    );
    setSourceUrl(row.source_url ?? "");
    setIsActive(row.is_active);
    setIsVerified(row.is_verified);
  }, [existingQuery.data]);

  useEffect(() => {
    if (prefillApplied || !prefillQuery.data?.prefill) return;
    const p = prefillQuery.data.prefill;
    setTitle(strPrefill(p.title) || prefillQuery.data.candidate.name);
    setShortDescription(strPrefill(p.short_description));
    setContent(strPrefill(p.content));
    if (typeof p.guide_type === "string" && TOURISM_GUIDE_TYPES.includes(p.guide_type as never)) {
      setGuideType(p.guide_type);
    }
    if (typeof p.admin_area_id === "string") setAdminAreaId(p.admin_area_id);
    setSourceUrl(strPrefill(p.source_url));
    if (typeof p.is_active === "boolean") setIsActive(p.is_active);
    if (typeof p.is_verified === "boolean") setIsVerified(p.is_verified);
    setPrefillApplied(true);
  }, [prefillQuery.data, prefillApplied]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        title: title.trim(),
        short_description: shortDescription.trim() || null,
        content: content.trim(),
        guide_type: guideType,
        admin_area_id: adminAreaId,
        place_public_id: place?.public_id ?? null,
        source_url: sourceUrl.trim() || null,
        is_active: isActive,
        is_verified: isVerified,
      };
      if (isNew) return createAdminTourismGuide(body);
      return updateAdminTourismGuide(guideId!, body);
    },
    onSuccess: async (row) => {
      if (fromResearch && isNew) {
        const entityType =
          researchCreatedEntityType(prefillQuery.data?.candidate.entity_type ?? "local_guide") ??
          "local_guide";
        try {
          await markAdminTourismResearchAdded(fromResearch, {
            created_entity_type: entityType,
            created_entity_public_id: row.public_id,
          });
        } catch (err) {
          setError(
            err instanceof Error
              ? `Guide saved, but research link failed: ${err.message}`
              : "Guide saved, but research link failed",
          );
          await queryClient.invalidateQueries({ queryKey: ["tourism-visitor", "guides"] });
          router.push(tourismPath(`guides/${row.public_id}`));
          return;
        }
        await queryClient.invalidateQueries({ queryKey: ["tourism-research"] });
      }
      await queryClient.invalidateQueries({ queryKey: ["tourism-visitor", "guides"] });
      router.push(tourismPath(`guides/${row.public_id}`));
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Save failed");
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          {isNew ? "New local guide" : "Edit local guide"}
        </h1>
        <Link href={tourismPath("guides")} className="text-sm text-gray-600 hover:underline">
          Back to guides
        </Link>
      </div>

      {existingQuery.isError ? (
        <p className="text-sm text-red-700">Guide not found or failed to load.</p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {fromResearch && prefillQuery.data ? (
        <ResearchEvidenceBanner prefill={prefillQuery.data} />
      ) : null}

      <form
        className="space-y-4 rounded-md border border-gray-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!adminAreaId) {
            setError("Township is required");
            return;
          }
          if (!content.trim()) {
            setError("Content is required");
            return;
          }
          saveMutation.mutate();
        }}
      >
        <label className="block text-sm text-gray-700">
          Title
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm text-gray-700">
          Short description
          <textarea
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value)}
            rows={2}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm text-gray-700">
          Content
          <textarea
            required
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm text-gray-700">
          Guide type
          <select
            value={guideType}
            onChange={(e) => setGuideType(e.target.value)}
            className={INPUT_CLASS}
          >
            {TOURISM_GUIDE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-2 text-sm text-gray-700">
          <div>Township / admin area</div>
          <input
            value={areaQuery}
            onChange={(e) => setAreaQuery(e.target.value)}
            placeholder="Search townships"
            className={INPUT_CLASS}
          />
          <select
            required
            value={adminAreaId}
            onChange={(e) => {
              setAdminAreaId(e.target.value);
              setPlace(null);
            }}
            className={INPUT_CLASS}
          >
            <option value="">Select township</option>
            {(areasQuery.data ?? []).map((area) => (
              <option key={area.id} value={area.id}>
                {area.canonical_name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2 text-sm text-gray-700">
          <div>Related place (optional)</div>
          <CorePlacePicker
            selectedTownshipId={adminAreaId || null}
            value={place}
            onChange={setPlace}
            required={false}
          />
        </div>
        <label className="block text-sm text-gray-700">
          Source URL
          <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className={INPUT_CLASS} />
        </label>
        <div className="flex flex-wrap gap-4 text-sm text-gray-700">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={isVerified}
              onChange={(e) => setIsVerified(e.target.checked)}
            />
            Verified
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={PRIMARY_BTN} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </button>
          <Link href={tourismPath("guides")} className={SECONDARY_BTN}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
