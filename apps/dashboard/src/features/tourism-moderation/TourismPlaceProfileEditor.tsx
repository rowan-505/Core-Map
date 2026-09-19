"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRouter } from "next/navigation";

import CorePlacePicker, {
  type CorePlaceSelection,
} from "@/src/components/tourism/CorePlacePicker";
import { getAdminAreaOptions } from "@/src/lib/api";
import { tourismPath } from "@/src/lib/dashboardPaths";

import {
  createTourismPlaceProfile,
  getTourismPlaceProfile,
  listTourismTypes,
  updateTourismPlaceProfile,
} from "./api";
import { formatDateTime, formatLocation } from "./constants";
import { permissionDeniedMessage } from "./filters";
import {
  buildTourismProfilePayload,
  defaultTourismProfileForm,
  editorialLevelLabel,
  visitorCostCodeFromPriceLevel,
  VISITOR_COST_OPTIONS,
  type TourismProfileFormValues,
} from "./profileForm";

const INPUT_CLASS =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const SECONDARY_BTN =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_BTN =
  "inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50";
const SECTION =
  "space-y-3 rounded-lg border border-gray-200 bg-white p-4";
const SECTION_TITLE =
  "text-sm font-semibold uppercase tracking-wide text-gray-500";
const SEASON_MODES = [
  { code: "all_year", label: "All year" },
  { code: "best_months", label: "Best months" },
  { code: "poor_months", label: "Poor months" },
  { code: "temporarily_closed", label: "Temporarily closed" },
] as const;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

type TourismPlaceProfileEditorProps = {
  readonly placePublicId?: string;
  readonly mode: "create" | "update";
};

function profileFormFromData(data: {
  tourism_type: string;
  short_description: string | null;
  price_level: number | null;
  editor_pick: boolean;
  is_public?: boolean | null;
  editorial_score: number;
  manual_boost: number;
  season_mode: TourismProfileFormValues["season_mode"];
  season_start_month: number | null;
  season_end_month: number | null;
}): TourismProfileFormValues {
  return defaultTourismProfileForm({
    tourism_type: data.tourism_type,
    short_description: data.short_description ?? "",
    price_level: visitorCostCodeFromPriceLevel(data.price_level),
    editor_pick: data.editor_pick,
    is_public: data.is_public ?? true,
    editorial_score: String(data.editorial_score),
    manual_boost: String(data.manual_boost),
    season_mode: data.season_mode,
    season_start_month:
      data.season_start_month === null ? "" : String(data.season_start_month),
    season_end_month:
      data.season_end_month === null ? "" : String(data.season_end_month),
  });
}

export default function TourismPlaceProfileEditor({
  placePublicId,
  mode,
}: TourismPlaceProfileEditorProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [townshipId, setTownshipId] = useState("");
  const [areaQuery, setAreaQuery] = useState("");
  const [selectedPlace, setSelectedPlace] = useState<CorePlaceSelection | null>(null);
  const [form, setForm] = useState<TourismProfileFormValues>(defaultTourismProfileForm());
  const [baseline, setBaseline] = useState<TourismProfileFormValues>(
    defaultTourismProfileForm(),
  );
  const [hydratedProfileKey, setHydratedProfileKey] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ["tourism-moderation", "profile", placePublicId],
    enabled: mode === "update" && Boolean(placePublicId),
    queryFn: ({ signal }) => getTourismPlaceProfile(placePublicId!, { signal }),
  });
  const typesQuery = useQuery({
    queryKey: ["tourism", "types"],
    queryFn: ({ signal }) => listTourismTypes({ signal }),
    staleTime: 5 * 60 * 1000,
  });
  const areasQuery = useQuery({
    queryKey: ["admin-area-options", "tourism-attraction-create", areaQuery],
    queryFn: () =>
      getAdminAreaOptions({ limit: 200, q: areaQuery || undefined, townshipOnly: true }),
    enabled: mode === "create",
  });

  const profile = profileQuery.data;
  const profileKey = profile
    ? `${profile.public_id}:${profile.updated_at ?? ""}`
    : null;
  if (profile && profileKey !== hydratedProfileKey) {
    const next = profileFormFromData(profile);
    setHydratedProfileKey(profileKey);
    setForm(next);
    setBaseline(next);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const targetPlaceId = (
        mode === "create" ? selectedPlace?.public_id : placePublicId ?? ""
      )?.trim();
      if (!targetPlaceId) {
        throw new Error("Select a CoreMap place first.");
      }
      if (mode === "create" && selectedPlace?.has_tourism_profile === true) {
        throw new Error("This place is already a tourism attraction.");
      }
      const built = buildTourismProfilePayload(form, {
        mode,
        previous: baseline,
      });
      if (!built.ok) {
        throw new Error(built.error);
      }
      if (mode === "create") {
        return createTourismPlaceProfile(targetPlaceId, built.create);
      }
      return updateTourismPlaceProfile(targetPlaceId, built.patch);
    },
    onSuccess: async (data) => {
      setLocalError(null);
      setToast(mode === "create" ? "Tourism profile created" : "Tourism profile saved");
      setBaseline(form);
      await queryClient.invalidateQueries({ queryKey: ["tourism-moderation", "places"] });
      await queryClient.invalidateQueries({
        queryKey: ["tourism-moderation", "profile", data.public_id],
      });
      if (mode === "create") {
        router.replace(tourismPath(`places/${data.public_id}`));
      }
    },
    onError: (error) => {
      setToast(null);
      setLocalError(permissionDeniedMessage(error));
    },
  });

  if (mode === "update" && profileQuery.isLoading) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-gray-500">Loading tourism profile…</p>
      </div>
    );
  }

  if (mode === "update" && (profileQuery.isError || !profileQuery.data)) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-6">
        <p className="text-sm text-red-700">
          {permissionDeniedMessage(profileQuery.error)}
        </p>
        <Link href={tourismPath("places")} className={SECONDARY_BTN}>
          Back to attractions
        </Link>
      </div>
    );
  }

  const busy = saveMutation.isPending;
  const showSeasonMonths =
    form.season_mode === "best_months" || form.season_mode === "poor_months";
  const placeVerified =
    mode === "update" ? profile?.is_verified : selectedPlace?.is_verified ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      {toast ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {toast}
        </div>
      ) : null}
      {localError ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {localError}
        </div>
      ) : null}

      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          {mode === "create" ? "Create attraction" : "Edit attraction"}
        </h1>
        {profile ? (
          <p className="mt-1 text-sm text-gray-600">
            {profile.name} · {formatLocation(profile.lat, profile.lng)}
          </p>
        ) : (
          <p className="mt-1 text-sm text-gray-600">
            Manage what this attraction is and when it is available. Ranking controls live on the
            Ranking page.
          </p>
        )}
      </div>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setLocalError(null);
          saveMutation.mutate();
        }}
      >
        <section className={SECTION}>
          <h2 className={SECTION_TITLE}>Place</h2>
          {mode === "create" ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Township
                </span>
                <input
                  value={areaQuery}
                  onChange={(e) => setAreaQuery(e.target.value)}
                  placeholder="Search townships"
                  className={INPUT_CLASS}
                />
                <select
                  required
                  value={townshipId}
                  onChange={(e) => {
                    setTownshipId(e.target.value);
                    setSelectedPlace(null);
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
              <CorePlacePicker
                selectedTownshipId={townshipId || null}
                value={selectedPlace}
                onChange={setSelectedPlace}
                required
                blockExistingTourismProfiles
              />
            </div>
          ) : (
            <div className="space-y-1 text-sm text-gray-700">
              <p className="font-medium text-gray-900">{profile?.name}</p>
              <p className="font-mono text-xs text-gray-500">{placePublicId}</p>
            </div>
          )}
        </section>

        <section className={SECTION}>
          <h2 className={SECTION_TITLE}>Tourism details</h2>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Tourism type
            </span>
            <select
              required
              value={form.tourism_type}
              onChange={(e) => setForm((prev) => ({ ...prev, tourism_type: e.target.value }))}
              className={INPUT_CLASS}
              disabled={typesQuery.isLoading}
            >
              <option value="">
                {typesQuery.isLoading ? "Loading tourism types…" : "Select a tourism type"}
              </option>
              {typesQuery.data?.items.map((type) => (
                <option key={type.code} value={type.code}>
                  {type.name_en} ({type.code}){type.name_mm ? ` · ${type.name_mm}` : ""}
                </option>
              ))}
            </select>
          </label>
          {typesQuery.isError ? (
            <p className="text-sm text-red-700">
              Tourism types could not be loaded. Refresh before saving.
            </p>
          ) : null}

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Short description
            </span>
            <textarea
              rows={4}
              value={form.short_description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, short_description: e.target.value }))
              }
              className={INPUT_CLASS}
              maxLength={1000}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Visitor cost
            </span>
            <select
              value={form.price_level}
              onChange={(e) => setForm((prev) => ({ ...prev, price_level: e.target.value }))}
              className={INPUT_CLASS}
            >
              {VISITOR_COST_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-4 text-sm text-gray-800">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.is_public}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, is_public: e.target.checked }))
                }
                className="h-4 w-4 rounded border-gray-300"
              />
              Public
            </label>
            <div className="inline-flex items-center gap-2 text-gray-600">
              <span className="font-medium text-gray-800">Verified</span>
              <span>
                {placeVerified == null ? "—" : placeVerified ? "Yes (CoreMap place)" : "No"}
              </span>
            </div>
          </div>
        </section>

        <section className={SECTION}>
          <h2 className={SECTION_TITLE}>Season</h2>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Season mode
            </span>
            <select
              value={form.season_mode}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  season_mode: e.target.value as TourismProfileFormValues["season_mode"],
                }))
              }
              className={INPUT_CLASS}
            >
              {SEASON_MODES.map((season) => (
                <option key={season.code} value={season.code}>
                  {season.label}
                </option>
              ))}
            </select>
          </label>

          {showSeasonMonths ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {(["season_start_month", "season_end_month"] as const).map((field, index) => (
                <label key={field} className="block space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {index === 0 ? "Start month (optional)" : "End month (optional)"}
                  </span>
                  <select
                    value={form[field]}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, [field]: e.target.value }))
                    }
                    className={INPUT_CLASS}
                  >
                    <option value="">Not set</option>
                    {MONTHS.map((month, monthIndex) => (
                      <option key={month} value={monthIndex + 1}>
                        {month}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ) : null}
        </section>

        <section className={SECTION}>
          <h2 className={SECTION_TITLE}>Ranking</h2>
          <p className="text-sm text-gray-600">
            Compact controls only. Full score management is on the Ranking page.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Editorial level
              </span>
              <select
                value={form.editorial_score}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, editorial_score: e.target.value }))
                }
                className={INPUT_CLASS}
              >
                {["20", "35", "50", "65", "80", "95"].map((score) => (
                  <option key={score} value={score}>
                    {editorialLevelLabel(score)} ({score})
                  </option>
                ))}
              </select>
            </label>
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={form.editor_pick}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, editor_pick: e.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                />
                <span>
                  <span className="font-medium">Featured by CoreMap</span>
                  <span className="mt-0.5 block text-xs text-gray-500">
                    Highlights this attraction in curated discovery. It does not directly set rank.
                  </span>
                </span>
              </label>
            </div>
          </div>
          <Link href={tourismPath("ranking")} className={SECONDARY_BTN}>
            Open Ranking Management
          </Link>
          {mode === "update" && profile ? (
            <dl className="grid gap-2 rounded-md border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600 sm:grid-cols-2">
              <div>
                <dt className="font-semibold uppercase tracking-wide">Updated</dt>
                <dd className="mt-0.5">{formatDateTime(profile.updated_at)}</dd>
              </div>
              {profile.address?.full_address ? (
                <div className="sm:col-span-2">
                  <dt className="font-semibold uppercase tracking-wide">Address</dt>
                  <dd className="mt-0.5">{profile.address.full_address}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </section>

        <div className="flex flex-wrap gap-2 pt-1">
          <button type="submit" className={PRIMARY_BTN} disabled={busy}>
            {busy ? "Saving…" : mode === "create" ? "Create attraction" : "Save changes"}
          </button>
          <Link href={tourismPath("places")} className={SECONDARY_BTN}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
