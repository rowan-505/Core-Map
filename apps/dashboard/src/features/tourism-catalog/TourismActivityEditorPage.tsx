"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import CorePlacePicker, {
  type CorePlaceSelection,
} from "@/src/components/tourism/CorePlacePicker";
import { getAdminAreaOptions } from "@/src/lib/api";
import { tourismPath } from "@/src/lib/dashboardPaths";

import {
  confirmAdminTourismActivityScheduleReview,
  createAdminTourismActivity,
  getAdminTourismActivity,
  listAdminActivityTypes,
  updateAdminTourismActivity,
} from "./api";
import { ACTIVITY_SEASON_MODES, reviewStatusLabel } from "./types";

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const PRIMARY_BTN =
  "rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50";
const SECONDARY_BTN =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50";

export default function TourismActivityEditorPage({
  activityId,
}: {
  activityId?: string;
}) {
  const isNew = !activityId;
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [activityType, setActivityType] = useState("sightseeing");
  const [adminAreaId, setAdminAreaId] = useState("");
  const [areaQuery, setAreaQuery] = useState("");
  const [place, setPlace] = useState<CorePlaceSelection | null>(null);
  const [seasonMode, setSeasonMode] = useState<string>("all_year");
  const [seasonStart, setSeasonStart] = useState("");
  const [seasonEnd, setSeasonEnd] = useState("");
  const [displayPriority, setDisplayPriority] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [isVerified, setIsVerified] = useState(false);
  const [requiresReview, setRequiresReview] = useState(false);
  const [nextReviewDue, setNextReviewDue] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const existingQuery = useQuery({
    queryKey: ["tourism-catalog", "activity", activityId],
    queryFn: ({ signal }) => getAdminTourismActivity(activityId!, { signal }),
    enabled: Boolean(activityId),
  });
  const typesQuery = useQuery({
    queryKey: ["tourism-catalog", "activity-types"],
    queryFn: ({ signal }) => listAdminActivityTypes({ signal }),
  });
  const areasQuery = useQuery({
    queryKey: ["admin-area-options", "tourism-activity-editor", areaQuery],
    queryFn: () =>
      getAdminAreaOptions({ limit: 200, q: areaQuery || undefined, townshipOnly: true }),
  });

  useEffect(() => {
    const row = existingQuery.data;
    if (!row) return;
    setName(row.name);
    setShortDescription(row.short_description ?? "");
    setActivityType(row.activity_type);
    setAdminAreaId(row.admin_area_id);
    setPlace(
      row.primary_place_public_id
        ? {
            public_id: row.primary_place_public_id,
            display_name: row.primary_place_name ?? row.primary_place_public_id,
          }
        : null,
    );
    setSeasonMode(row.season_mode);
    setSeasonStart(row.season_start_month ? String(row.season_start_month) : "");
    setSeasonEnd(row.season_end_month ? String(row.season_end_month) : "");
    setDisplayPriority(String(row.display_priority));
    setIsActive(row.is_active);
    setIsVerified(row.is_verified);
    setRequiresReview(row.requires_schedule_review);
    setNextReviewDue(row.next_review_due_at ? row.next_review_due_at.slice(0, 16) : "");
    setReviewNote(row.schedule_review_note ?? "");
  }, [existingQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        name: name.trim(),
        short_description: shortDescription.trim() || null,
        activity_type: activityType,
        admin_area_id: adminAreaId,
        primary_place_public_id: place?.public_id ?? null,
        season_mode: seasonMode,
        season_start_month: seasonStart ? Number(seasonStart) : null,
        season_end_month: seasonEnd ? Number(seasonEnd) : null,
        display_priority: Number(displayPriority) || 0,
        is_active: isActive,
        is_verified: isVerified,
        requires_schedule_review: requiresReview,
      };
      if (isNew) return createAdminTourismActivity(body);
      return updateAdminTourismActivity(activityId!, body);
    },
    onSuccess: async (row) => {
      await queryClient.invalidateQueries({ queryKey: ["tourism-catalog", "activities"] });
      router.push(tourismPath(`activities/${row.public_id}`));
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Save failed");
    },
  });

  const confirmReviewMutation = useMutation({
    mutationFn: () => {
      if (!nextReviewDue) {
        throw new Error("Next review due is required to confirm schedule review");
      }
      return confirmAdminTourismActivityScheduleReview(activityId!, {
        next_review_due_at: new Date(nextReviewDue).toISOString(),
        schedule_review_note: reviewNote.trim() || null,
        requires_schedule_review: requiresReview,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["tourism-catalog", "activity", activityId],
      });
      await queryClient.invalidateQueries({ queryKey: ["tourism-catalog", "activities"] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Confirm review failed");
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {isNew ? "New activity" : "Edit activity"}
          </h1>
          <Link href={tourismPath("activities")} className="text-sm text-gray-600 hover:underline">
            Back to activities
          </Link>
        </div>
      </div>

      {existingQuery.isError ? (
        <p className="text-sm text-red-700">Activity not found or failed to load.</p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {!isNew && existingQuery.data ? (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Review status:{" "}
          <span className="font-medium">
            {reviewStatusLabel(existingQuery.data.review_status)}
          </span>
          {existingQuery.data.needs_review ? (
            <span className="ml-2 text-amber-800">Needs review</span>
          ) : null}
          {existingQuery.data.last_schedule_reviewed_at ? (
            <div className="mt-1 text-xs text-gray-500">
              Last reviewed{" "}
              {new Date(existingQuery.data.last_schedule_reviewed_at).toLocaleString()}
            </div>
          ) : null}
        </div>
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
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
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
          Activity type
          <select
            value={activityType}
            onChange={(e) => setActivityType(e.target.value)}
            className={INPUT_CLASS}
          >
            {(typesQuery.data?.items ?? []).map((type) => (
              <option key={type.code} value={type.code}>
                {type.name_en}
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
          <div>Primary place (optional)</div>
          <CorePlacePicker
            selectedTownshipId={adminAreaId || null}
            value={place}
            onChange={setPlace}
            required={false}
          />
        </div>
        <label className="block text-sm text-gray-700">
          Season mode
          <select
            value={seasonMode}
            onChange={(e) => setSeasonMode(e.target.value)}
            className={INPUT_CLASS}
          >
            {ACTIVITY_SEASON_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          {(seasonMode === "best_months" || seasonMode === "poor_months") ? (
            <>
              <label className="block text-sm text-gray-700">
                Season start month
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={seasonStart}
                  onChange={(e) => setSeasonStart(e.target.value)}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="block text-sm text-gray-700">
                Season end month
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={seasonEnd}
                  onChange={(e) => setSeasonEnd(e.target.value)}
                  className={INPUT_CLASS}
                />
              </label>
            </>
          ) : null}
        </div>
        <label className="block text-sm text-gray-700">
          Display priority
          <input
            type="number"
            value={displayPriority}
            onChange={(e) => setDisplayPriority(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <div className="flex flex-wrap gap-4 text-sm text-gray-700">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
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
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={requiresReview}
              onChange={(e) => setRequiresReview(e.target.checked)}
            />
            Requires schedule review
          </label>
        </div>
        <label className="block text-sm text-gray-700">
          Next review due
          <input
            type="datetime-local"
            value={nextReviewDue}
            onChange={(e) => setNextReviewDue(e.target.value)}
            className={INPUT_CLASS}
          />
          <span className="mt-1 block text-xs text-gray-500">
            Applied only when you confirm schedule reviewed.
          </span>
        </label>
        <label className="block text-sm text-gray-700">
          Schedule review note
          <textarea
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            rows={2}
            className={INPUT_CLASS}
          />
          <span className="mt-1 block text-xs text-gray-500">
            Applied only when you confirm schedule reviewed.
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={PRIMARY_BTN} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </button>
          {!isNew ? (
            <button
              type="button"
              className={SECONDARY_BTN}
              disabled={confirmReviewMutation.isPending}
              onClick={() => {
                setError(null);
                confirmReviewMutation.mutate();
              }}
            >
              {confirmReviewMutation.isPending ? "Confirming…" : "Confirm schedule reviewed"}
            </button>
          ) : null}
          <Link href={tourismPath("activities")} className={SECONDARY_BTN}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
