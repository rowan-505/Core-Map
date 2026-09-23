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
  createAdminTourismFood,
  createAdminTourismFoodPlaceLink,
  deleteAdminTourismFoodPlaceLink,
  getAdminTourismFood,
  updateAdminTourismFood,
} from "./api";
import { TOURISM_FOOD_LABELS, TOURISM_FOOD_TYPES } from "./types";

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const PRIMARY_BTN =
  "rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50";
const SECONDARY_BTN =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";

function strPrefill(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export default function TourismFoodEditorPage({ foodId }: { foodId?: string }) {
  const isNew = !foodId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromResearch = searchParams.get("from_research")?.trim() || null;
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameMm, setNameMm] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [foodType, setFoodType] = useState<string>("dish");
  const [labels, setLabels] = useState<string[]>([]);
  const [adminAreaId, setAdminAreaId] = useState("");
  const [areaQuery, setAreaQuery] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isVerified, setIsVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefillApplied, setPrefillApplied] = useState(false);

  const [linkPlace, setLinkPlace] = useState<CorePlaceSelection | null>(null);
  const [linkNote, setLinkNote] = useState("");
  const [linkSignature, setLinkSignature] = useState(false);
  const [linkVerified, setLinkVerified] = useState(false);
  const [linkSourceUrl, setLinkSourceUrl] = useState("");

  const existingQuery = useQuery({
    queryKey: ["tourism-visitor", "food", foodId],
    queryFn: ({ signal }) => getAdminTourismFood(foodId!, { signal }),
    enabled: Boolean(foodId),
  });
  const prefillQuery = useQuery({
    queryKey: ["tourism-research", "prefill", fromResearch],
    queryFn: ({ signal }) => getAdminTourismResearchPrefill(fromResearch!, { signal }),
    enabled: isNew && Boolean(fromResearch),
  });
  const areasQuery = useQuery({
    queryKey: ["admin-area-options", "tourism-food-editor", areaQuery],
    queryFn: () =>
      getAdminAreaOptions({ limit: 200, q: areaQuery || undefined, townshipOnly: true }),
  });

  useEffect(() => {
    const row = existingQuery.data;
    if (!row) return;
    setName(row.name);
    setNameEn(row.name_en ?? "");
    setNameMm(row.name_mm ?? "");
    setShortDescription(row.short_description ?? "");
    setFoodType(row.food_type);
    setLabels(row.labels ?? []);
    setAdminAreaId(row.admin_area_id);
    setSourceUrl(row.source_url ?? "");
    setIsActive(row.is_active);
    setIsVerified(row.is_verified);
  }, [existingQuery.data]);

  useEffect(() => {
    if (prefillApplied || !prefillQuery.data?.prefill) return;
    const p = prefillQuery.data.prefill;
    setName(strPrefill(p.name) || prefillQuery.data.candidate.name);
    setNameEn(strPrefill(p.name_en));
    setNameMm(strPrefill(p.name_mm));
    setShortDescription(strPrefill(p.short_description));
    if (typeof p.food_type === "string" && TOURISM_FOOD_TYPES.includes(p.food_type as never)) {
      setFoodType(p.food_type);
    }
    if (Array.isArray(p.labels)) {
      setLabels(p.labels.filter((l): l is string => typeof l === "string"));
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
        name: name.trim(),
        name_en: nameEn.trim() || null,
        name_mm: nameMm.trim() || null,
        short_description: shortDescription.trim() || null,
        food_type: foodType,
        labels,
        admin_area_id: adminAreaId,
        source_url: sourceUrl.trim() || null,
        is_active: isActive,
        is_verified: isVerified,
      };
      if (isNew) return createAdminTourismFood(body);
      return updateAdminTourismFood(foodId!, body);
    },
    onSuccess: async (row) => {
      if (fromResearch && isNew) {
        const entityType =
          researchCreatedEntityType(prefillQuery.data?.candidate.entity_type ?? "food") ?? "food";
        try {
          await markAdminTourismResearchAdded(fromResearch, {
            created_entity_type: entityType,
            created_entity_public_id: row.public_id,
          });
        } catch (err) {
          setError(
            err instanceof Error
              ? `Food saved, but research link failed: ${err.message}`
              : "Food saved, but research link failed",
          );
          await queryClient.invalidateQueries({ queryKey: ["tourism-visitor", "foods"] });
          router.push(tourismPath(`foods/${row.public_id}`));
          return;
        }
        await queryClient.invalidateQueries({ queryKey: ["tourism-research"] });
      }
      await queryClient.invalidateQueries({ queryKey: ["tourism-visitor", "foods"] });
      router.push(tourismPath(`foods/${row.public_id}`));
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Save failed");
    },
  });

  const addLinkMutation = useMutation({
    mutationFn: async () => {
      if (!foodId || !linkPlace) throw new Error("Select a place");
      return createAdminTourismFoodPlaceLink(foodId, {
        place_public_id: linkPlace.public_id,
        availability_note: linkNote.trim() || null,
        is_signature_here: linkSignature,
        is_verified: linkVerified,
        source_url: linkSourceUrl.trim() || null,
      });
    },
    onSuccess: async () => {
      setLinkPlace(null);
      setLinkNote("");
      setLinkSignature(false);
      setLinkVerified(false);
      setLinkSourceUrl("");
      await queryClient.invalidateQueries({ queryKey: ["tourism-visitor", "food", foodId] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to add place link");
    },
  });

  const removeLinkMutation = useMutation({
    mutationFn: (placePublicId: string) => deleteAdminTourismFoodPlaceLink(foodId!, placePublicId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tourism-visitor", "food", foodId] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to remove place link");
    },
  });

  const toggleLabel = (label: string) => {
    setLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
  };

  const places = existingQuery.data?.places ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{isNew ? "New food" : "Edit food"}</h1>
        <Link href={tourismPath("foods")} className="text-sm text-gray-600 hover:underline">
          Back to foods
        </Link>
      </div>

      {existingQuery.isError ? (
        <p className="text-sm text-red-700">Food not found or failed to load.</p>
      ) : null}
      {prefillQuery.isError ? (
        <p className="text-sm text-red-700">Research prefill failed to load.</p>
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
          Name
          <input required value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLASS} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-gray-700">
            Name (English)
            <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={INPUT_CLASS} />
          </label>
          <label className="block text-sm text-gray-700">
            Name (Myanmar)
            <input value={nameMm} onChange={(e) => setNameMm(e.target.value)} className={INPUT_CLASS} />
          </label>
        </div>
        <label className="block text-sm text-gray-700">
          Short description
          <textarea
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value)}
            rows={3}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm text-gray-700">
          Food type
          <select
            value={foodType}
            onChange={(e) => setFoodType(e.target.value)}
            className={INPUT_CLASS}
          >
            {TOURISM_FOOD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="text-sm text-gray-700">
          <legend className="mb-1">Labels</legend>
          <div className="flex flex-wrap gap-3">
            {TOURISM_FOOD_LABELS.map((label) => (
              <label key={label} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={labels.includes(label)}
                  onChange={() => toggleLabel(label)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
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
            onChange={(e) => setAdminAreaId(e.target.value)}
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
          <Link href={tourismPath("foods")} className={SECONDARY_BTN}>
            Cancel
          </Link>
        </div>
      </form>

      {!isNew ? (
        <section className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Linked places</h2>
          {places.length === 0 ? (
            <p className="text-sm text-gray-500">No places linked yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {places.map((link) => (
                <li
                  key={link.place_public_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-100 px-2 py-1.5"
                >
                  <span>
                    {link.place_name}
                    {link.is_signature_here ? (
                      <span className="ml-1 text-xs text-amber-800">signature</span>
                    ) : null}
                    {link.availability_note ? (
                      <span className="ml-1 text-xs text-gray-500">— {link.availability_note}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className={SECONDARY_BTN}
                    disabled={removeLinkMutation.isPending}
                    onClick={() => removeLinkMutation.mutate(link.place_public_id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2 border-t border-gray-100 pt-3">
            <CorePlacePicker
              selectedTownshipId={adminAreaId || null}
              value={linkPlace}
              onChange={setLinkPlace}
              required={false}
            />
            <label className="block text-sm text-gray-700">
              Availability note
              <input
                value={linkNote}
                onChange={(e) => setLinkNote(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={linkSignature}
                onChange={(e) => setLinkSignature(e.target.checked)}
              />
              Signature dish at this place
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={linkVerified}
                onChange={(e) => setLinkVerified(e.target.checked)}
              />
              Link verified
            </label>
            <label className="block text-sm text-gray-700">
              Link source URL
              <input
                value={linkSourceUrl}
                onChange={(e) => setLinkSourceUrl(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <button
              type="button"
              className={PRIMARY_BTN}
              disabled={!linkPlace || addLinkMutation.isPending}
              onClick={() => addLinkMutation.mutate()}
            >
              {addLinkMutation.isPending ? "Adding…" : "Add place link"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
