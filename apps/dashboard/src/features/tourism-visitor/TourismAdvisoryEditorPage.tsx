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
  createAdminTourismAdvisory,
  getAdminTourismAdvisory,
  updateAdminTourismAdvisory,
} from "./api";
import { TOURISM_ADVISORY_SEVERITIES, TOURISM_ADVISORY_TYPES } from "./types";

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const PRIMARY_BTN =
  "rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50";
const SECONDARY_BTN =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50";

function strPrefill(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 16);
}

export default function TourismAdvisoryEditorPage({
  advisoryId,
}: {
  advisoryId?: string;
}) {
  const isNew = !advisoryId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromResearch = searchParams.get("from_research")?.trim() || null;
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [advisoryType, setAdvisoryType] = useState<string>("visitor_requirement");
  const [severity, setSeverity] = useState<string>("info");
  const [adminAreaId, setAdminAreaId] = useState("");
  const [areaQuery, setAreaQuery] = useState("");
  const [place, setPlace] = useState<CorePlaceSelection | null>(null);
  const [activityPublicId, setActivityPublicId] = useState("");
  const [eventPublicId, setEventPublicId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isVerified, setIsVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefillApplied, setPrefillApplied] = useState(false);

  const existingQuery = useQuery({
    queryKey: ["tourism-visitor", "advisory", advisoryId],
    queryFn: ({ signal }) => getAdminTourismAdvisory(advisoryId!, { signal }),
    enabled: Boolean(advisoryId),
  });
  const prefillQuery = useQuery({
    queryKey: ["tourism-research", "prefill", fromResearch],
    queryFn: ({ signal }) => getAdminTourismResearchPrefill(fromResearch!, { signal }),
    enabled: isNew && Boolean(fromResearch),
  });
  const areasQuery = useQuery({
    queryKey: ["admin-area-options", "tourism-advisory-editor", areaQuery],
    queryFn: () =>
      getAdminAreaOptions({ limit: 200, q: areaQuery || undefined, townshipOnly: true }),
  });

  useEffect(() => {
    const row = existingQuery.data;
    if (!row) return;
    setTitle(row.title);
    setDescription(row.description);
    setAdvisoryType(row.advisory_type);
    setSeverity(row.severity);
    setAdminAreaId(row.admin_area_id);
    setPlace(
      row.place_public_id
        ? { public_id: row.place_public_id, display_name: row.place_name ?? row.place_public_id }
        : null,
    );
    setActivityPublicId(row.activity_public_id ?? "");
    setEventPublicId(row.event_public_id ?? "");
    setEffectiveFrom(isoToLocalInput(row.effective_from));
    setEffectiveUntil(isoToLocalInput(row.effective_until));
    setSourceUrl(row.source_url ?? "");
    setIsActive(row.is_active);
    setIsVerified(row.is_verified);
  }, [existingQuery.data]);

  useEffect(() => {
    if (prefillApplied || !prefillQuery.data?.prefill) return;
    const p = prefillQuery.data.prefill;
    setTitle(strPrefill(p.title) || prefillQuery.data.candidate.name);
    setDescription(strPrefill(p.description) || strPrefill(p.short_description));
    if (
      typeof p.advisory_type === "string" &&
      TOURISM_ADVISORY_TYPES.includes(p.advisory_type as never)
    ) {
      setAdvisoryType(p.advisory_type);
    }
    if (
      typeof p.severity === "string" &&
      TOURISM_ADVISORY_SEVERITIES.includes(p.severity as never)
    ) {
      setSeverity(p.severity);
    }
    if (typeof p.admin_area_id === "string") setAdminAreaId(p.admin_area_id);
    setEffectiveFrom(isoToLocalInput(strPrefill(p.effective_from) || null));
    setEffectiveUntil(isoToLocalInput(strPrefill(p.effective_until) || null));
    setSourceUrl(strPrefill(p.source_url));
    if (typeof p.is_active === "boolean") setIsActive(p.is_active);
    if (typeof p.is_verified === "boolean") setIsVerified(p.is_verified);
    setPrefillApplied(true);
  }, [prefillQuery.data, prefillApplied]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
        advisory_type: advisoryType,
        severity,
        admin_area_id: adminAreaId,
        place_public_id: place?.public_id ?? null,
        activity_public_id: activityPublicId.trim() || null,
        event_public_id: eventPublicId.trim() || null,
        effective_from: effectiveFrom ? new Date(effectiveFrom).toISOString() : null,
        effective_until: effectiveUntil ? new Date(effectiveUntil).toISOString() : null,
        source_url: sourceUrl.trim() || null,
        is_active: isActive,
        is_verified: isVerified,
      };
      if (isNew) return createAdminTourismAdvisory(body);
      return updateAdminTourismAdvisory(advisoryId!, body);
    },
    onSuccess: async (row) => {
      if (fromResearch && isNew) {
        const entityType =
          researchCreatedEntityType(prefillQuery.data?.candidate.entity_type ?? "advisory") ??
          "advisory";
        try {
          await markAdminTourismResearchAdded(fromResearch, {
            created_entity_type: entityType,
            created_entity_public_id: row.public_id,
          });
        } catch (err) {
          setError(
            err instanceof Error
              ? `Advisory saved, but research link failed: ${err.message}`
              : "Advisory saved, but research link failed",
          );
          await queryClient.invalidateQueries({ queryKey: ["tourism-visitor", "advisories"] });
          router.push(tourismPath(`advisories/${row.public_id}`));
          return;
        }
        await queryClient.invalidateQueries({ queryKey: ["tourism-research"] });
      }
      await queryClient.invalidateQueries({ queryKey: ["tourism-visitor", "advisories"] });
      router.push(tourismPath(`advisories/${row.public_id}`));
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Save failed");
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          {isNew ? "New advisory" : "Edit advisory"}
        </h1>
        <Link href={tourismPath("advisories")} className="text-sm text-gray-600 hover:underline">
          Back to advisories
        </Link>
      </div>

      {existingQuery.isError ? (
        <p className="text-sm text-red-700">Advisory not found or failed to load.</p>
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
          Description
          <textarea
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm text-gray-700">
          Advisory type
          <select
            value={advisoryType}
            onChange={(e) => setAdvisoryType(e.target.value)}
            className={INPUT_CLASS}
          >
            {TOURISM_ADVISORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-gray-700">
          Severity
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className={INPUT_CLASS}
          >
            {TOURISM_ADVISORY_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
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
          Activity public ID (optional)
          <input
            value={activityPublicId}
            onChange={(e) => setActivityPublicId(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm text-gray-700">
          Event public ID (optional)
          <input
            value={eventPublicId}
            onChange={(e) => setEventPublicId(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-gray-700">
            Effective from
            <input
              type="datetime-local"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="block text-sm text-gray-700">
            Effective until
            <input
              type="datetime-local"
              value={effectiveUntil}
              onChange={(e) => setEffectiveUntil(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
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
          <Link href={tourismPath("advisories")} className={SECONDARY_BTN}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
