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
  confirmAdminTourismEventScheduleReview,
  createAdminTourismEvent,
  createAdminTourismOccurrence,
  getAdminTourismEvent,
  listAdminEventTypes,
  listAdminTourismOccurrences,
  updateAdminTourismEvent,
  updateAdminTourismOccurrence,
} from "./api";
import {
  OCCURRENCE_STATUSES,
  reviewStatusLabel,
  type TourismOccurrenceAdmin,
} from "./types";

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const PRIMARY_BTN =
  "rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50";
const SECONDARY_BTN =
  "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string) {
  return new Date(value).toISOString();
}

export default function TourismEventDetailPage({
  eventId,
}: {
  eventId?: string;
}) {
  const isNew = !eventId;
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [eventType, setEventType] = useState("festival");
  const [adminAreaId, setAdminAreaId] = useState("");
  const [areaQuery, setAreaQuery] = useState("");
  const [place, setPlace] = useState<CorePlaceSelection | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [isVerified, setIsVerified] = useState(false);
  const [requiresReview, setRequiresReview] = useState(false);
  const [nextReviewDue, setNextReviewDue] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [showOccForm, setShowOccForm] = useState(false);
  const [editingOcc, setEditingOcc] = useState<TourismOccurrenceAdmin | null>(null);
  const [occStarts, setOccStarts] = useState("");
  const [occEnds, setOccEnds] = useState("");
  const [occStatus, setOccStatus] = useState("scheduled");
  const [occNote, setOccNote] = useState("");
  const [occSource, setOccSource] = useState("");

  const eventQuery = useQuery({
    queryKey: ["tourism-catalog", "event", eventId],
    queryFn: ({ signal }) => getAdminTourismEvent(eventId!, { signal }),
    enabled: Boolean(eventId),
  });
  const occQuery = useQuery({
    queryKey: ["tourism-catalog", "occurrences", eventId],
    queryFn: ({ signal }) => listAdminTourismOccurrences(eventId!, { signal }),
    enabled: Boolean(eventId),
  });
  const typesQuery = useQuery({
    queryKey: ["tourism-catalog", "event-types"],
    queryFn: ({ signal }) => listAdminEventTypes({ signal }),
  });
  const areasQuery = useQuery({
    queryKey: ["admin-area-options", "tourism-event-editor", areaQuery],
    queryFn: () =>
      getAdminAreaOptions({ limit: 200, q: areaQuery || undefined, townshipOnly: true }),
  });

  useEffect(() => {
    const row = eventQuery.data;
    if (!row) return;
    setName(row.name);
    setShortDescription(row.short_description ?? "");
    setEventType(row.event_type);
    setAdminAreaId(row.admin_area_id);
    setPlace(
      row.primary_place_public_id
        ? {
            public_id: row.primary_place_public_id,
            display_name: row.primary_place_name ?? row.primary_place_public_id,
          }
        : null,
    );
    setIsActive(row.is_active);
    setIsVerified(row.is_verified);
    setRequiresReview(row.requires_schedule_review);
    setNextReviewDue(row.next_review_due_at ? toLocalInput(row.next_review_due_at) : "");
    setReviewNote(row.schedule_review_note ?? "");
  }, [eventQuery.data]);

  const saveEventMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        name: name.trim(),
        short_description: shortDescription.trim() || null,
        event_type: eventType,
        admin_area_id: adminAreaId,
        primary_place_public_id: place?.public_id ?? null,
        is_active: isActive,
        is_verified: isVerified,
        requires_schedule_review: requiresReview,
      };
      if (isNew) return createAdminTourismEvent(body);
      return updateAdminTourismEvent(eventId!, body);
    },
    onSuccess: async (row) => {
      await queryClient.invalidateQueries({ queryKey: ["tourism-catalog", "events"] });
      if (isNew) router.push(tourismPath(`events/${row.public_id}`));
      else await queryClient.invalidateQueries({ queryKey: ["tourism-catalog", "event", eventId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Save failed"),
  });

  const saveOccMutation = useMutation({
    mutationFn: async () => {
      if (!eventId) throw new Error("Save the event first");
      if (!occStarts || !occEnds) throw new Error("Start and end are required");
      const body = {
        starts_at: fromLocalInput(occStarts),
        ends_at: fromLocalInput(occEnds),
        status: occStatus,
        schedule_note: occNote.trim() || null,
        source_url: occSource.trim() || null,
      };
      if (editingOcc) {
        return updateAdminTourismOccurrence(eventId, editingOcc.public_id, body);
      }
      return createAdminTourismOccurrence(eventId, body);
    },
    onSuccess: async () => {
      setShowOccForm(false);
      setEditingOcc(null);
      await queryClient.invalidateQueries({
        queryKey: ["tourism-catalog", "occurrences", eventId],
      });
      await queryClient.invalidateQueries({ queryKey: ["tourism-catalog", "event", eventId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Occurrence save failed"),
  });

  const statusMutation = useMutation({
    mutationFn: (input: { occurrenceId: string; status: string }) =>
      updateAdminTourismOccurrence(eventId!, input.occurrenceId, { status: input.status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["tourism-catalog", "occurrences", eventId],
      });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Status update failed"),
  });

  const confirmReviewMutation = useMutation({
    mutationFn: () => {
      if (!nextReviewDue) {
        throw new Error("Next review due is required to confirm schedule review");
      }
      return confirmAdminTourismEventScheduleReview(eventId!, {
        next_review_due_at: fromLocalInput(nextReviewDue),
        schedule_review_note: reviewNote.trim() || null,
        requires_schedule_review: requiresReview,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tourism-catalog", "event", eventId] });
      await queryClient.invalidateQueries({ queryKey: ["tourism-catalog", "events"] });
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Confirm review failed"),
  });

  function openCreateOcc() {
    setEditingOcc(null);
    setOccStarts("");
    setOccEnds("");
    setOccStatus("scheduled");
    setOccNote("");
    setOccSource("");
    setShowOccForm(true);
  }

  function openEditOcc(row: TourismOccurrenceAdmin) {
    setEditingOcc(row);
    setOccStarts(toLocalInput(row.starts_at));
    setOccEnds(toLocalInput(row.ends_at));
    setOccStatus(row.status);
    setOccNote(row.schedule_note ?? "");
    setOccSource(row.source_url ?? "");
    setShowOccForm(true);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          {isNew ? "New event" : eventQuery.data?.name ?? "Event"}
        </h1>
        <Link href={tourismPath("events")} className="text-sm text-gray-600 hover:underline">
          Back to events
        </Link>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {!isNew && eventQuery.data ? (
        <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          <div>
            Review status:{" "}
            <span className="font-medium">
              {reviewStatusLabel(eventQuery.data.review_status)}
            </span>
            {eventQuery.data.needs_review ? (
              <span className="ml-2 text-amber-800">Needs review</span>
            ) : null}
            {eventQuery.data.missing_next_occurrence ? (
              <span className="ml-2 text-orange-800">Missing next occurrence</span>
            ) : null}
          </div>
          {eventQuery.data.last_schedule_reviewed_at ? (
            <div className="text-xs text-gray-500">
              Last reviewed{" "}
              {new Date(eventQuery.data.last_schedule_reviewed_at).toLocaleString()}
            </div>
          ) : null}
          {eventQuery.data.last_occurrence ? (
            <div className="rounded border border-dashed border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-600">
              <div className="font-medium text-gray-700">Previous occurrence (reference only)</div>
              <div>
                {new Date(eventQuery.data.last_occurrence.starts_at).toLocaleString()} →{" "}
                {new Date(eventQuery.data.last_occurrence.ends_at).toLocaleString()} (
                {eventQuery.data.last_occurrence.status})
              </div>
              <div className="mt-0.5 text-gray-500">
                Dates are not copied automatically when adding the next occurrence.
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <section className="space-y-4 rounded-md border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Event information
        </h2>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!adminAreaId) {
              setError("Township is required");
              return;
            }
            saveEventMutation.mutate();
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
            Event type
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
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
            <div>Township</div>
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
            <button type="submit" className={PRIMARY_BTN} disabled={saveEventMutation.isPending}>
              {saveEventMutation.isPending ? "Saving…" : isNew ? "Create event" : "Save event"}
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
                {confirmReviewMutation.isPending
                  ? "Confirming…"
                  : "Confirm schedule reviewed"}
              </button>
            ) : null}
          </div>
        </form>
      </section>

      {!isNew ? (
        <section className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Occurrences
            </h2>
            <button type="button" className={PRIMARY_BTN} onClick={openCreateOcc}>
              Add occurrence
            </button>
          </div>

          {showOccForm ? (
            <form
              className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                saveOccMutation.mutate();
              }}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block text-sm text-gray-700">
                  Starts at
                  <input
                    required
                    type="datetime-local"
                    value={occStarts}
                    onChange={(e) => setOccStarts(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="block text-sm text-gray-700">
                  Ends at
                  <input
                    required
                    type="datetime-local"
                    value={occEnds}
                    onChange={(e) => setOccEnds(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </label>
              </div>
              <label className="block text-sm text-gray-700">
                Status
                <select
                  value={occStatus}
                  onChange={(e) => setOccStatus(e.target.value)}
                  className={INPUT_CLASS}
                >
                  {OCCURRENCE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-gray-700">
                Schedule note
                <textarea
                  value={occNote}
                  onChange={(e) => setOccNote(e.target.value)}
                  rows={2}
                  placeholder="Open daily 10:00–18:00"
                  className={INPUT_CLASS}
                />
              </label>
              <label className="block text-sm text-gray-700">
                Source URL
                <input
                  value={occSource}
                  onChange={(e) => setOccSource(e.target.value)}
                  className={INPUT_CLASS}
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className={PRIMARY_BTN}
                  disabled={saveOccMutation.isPending}
                >
                  {editingOcc ? "Save occurrence" : "Create occurrence"}
                </button>
                <button
                  type="button"
                  className={SECONDARY_BTN}
                  onClick={() => {
                    setShowOccForm(false);
                    setEditingOcc(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Date range</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Schedule note</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Verified</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(occQuery.data?.items ?? []).map((row) => (
                  <tr key={row.public_id} className="border-b border-gray-100">
                    <td className="px-3 py-2">
                      <div>{new Date(row.starts_at).toLocaleString()}</div>
                      <div className="text-xs text-gray-500">
                        → {new Date(row.ends_at).toLocaleString()}
                      </div>
                      <div className="text-xs text-gray-500">
                        {row.derived_state} · {row.duration_days.toFixed(1)} days
                      </div>
                    </td>
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2 text-gray-700">{row.schedule_note ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {row.source_url ? (
                        <a
                          href={row.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-700 hover:underline"
                        >
                          Source
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {row.verified_at ? new Date(row.verified_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className={SECONDARY_BTN}
                          onClick={() => openEditOcc(row)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={SECONDARY_BTN}
                          disabled={statusMutation.isPending || row.status === "confirmed"}
                          onClick={() =>
                            statusMutation.mutate({
                              occurrenceId: row.public_id,
                              status: "confirmed",
                            })
                          }
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          className={SECONDARY_BTN}
                          disabled={statusMutation.isPending || row.status === "cancelled"}
                          onClick={() =>
                            statusMutation.mutate({
                              occurrenceId: row.public_id,
                              status: "cancelled",
                            })
                          }
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className={SECONDARY_BTN}
                          disabled={statusMutation.isPending || row.status === "completed"}
                          onClick={() =>
                            statusMutation.mutate({
                              occurrenceId: row.public_id,
                              status: "completed",
                            })
                          }
                        >
                          Mark completed
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!occQuery.isLoading && (occQuery.data?.items.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                      No occurrences yet. Add one for each year or date range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
