"use client";

import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { getAdminAreaOptions } from "@/src/lib/api";
import { tourismPath } from "@/src/lib/dashboardPaths";

import {
  getTourismPlaceProfile,
  listAdminTourismGeoRanking,
  listTourismTypes,
  previewAdminTourismRanking,
  updateTourismPlaceProfile,
  type TourismGeoRankedPlaceAdmin,
  type TourismGeoRankingScope,
  type TourismRankingPreviewResponse,
} from "./api";
import { permissionDeniedMessage } from "./filters";
import { editorialLevelLabel } from "./profileForm";
import {
  TOURISM_EDITORIAL_SCORES,
  type TourismEditorialScore,
  type TourismSeasonMode,
} from "./types";

const SELECT_CLASS =
  "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const INPUT_CLASS =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const PRIMARY_BTN =
  "inline-flex items-center justify-center rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50";
const SECONDARY_BTN =
  "inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50";
const PAGE_SIZE = 25;
const PREVIEW_DEBOUNCE_MS = 350;
const REGION_LEVELS = new Set(["region", "state", "state_region", "division"]);
const SEASON_MODES: ReadonlyArray<{ code: TourismSeasonMode; label: string }> = [
  { code: "all_year", label: "All year" },
  { code: "best_months", label: "Best months" },
  { code: "poor_months", label: "Poor months" },
  { code: "temporarily_closed", label: "Temporarily closed" },
];
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

function pct(weight: number): string {
  return `${Math.round(weight * 100)}%`;
}

function formatScore(value: number): string {
  return value.toFixed(2);
}

function seasonLabel(mode: string): string {
  return SEASON_MODES.find((row) => row.code === mode)?.label ?? mode;
}

function ratingSummary(item: TourismGeoRankedPlaceAdmin): string {
  if (item.published_review_count <= 0 || item.average_rating == null) {
    return "No reviews";
  }
  return `${item.average_rating.toFixed(1)} · ${item.published_review_count} reviews`;
}

type RankingEditState = {
  editorial_score: string;
  season_mode: TourismSeasonMode;
  season_start_month: string;
  season_end_month: string;
  manual_boost: string;
  manual_boost_reason: string;
  editor_pick: boolean;
};

function editStateFromItem(item: TourismGeoRankedPlaceAdmin): RankingEditState {
  return {
    editorial_score: String(item.editorial_score),
    season_mode: item.season_mode as TourismSeasonMode,
    season_start_month:
      item.season_start_month == null ? "" : String(item.season_start_month),
    season_end_month: item.season_end_month == null ? "" : String(item.season_end_month),
    manual_boost: String(item.manual_boost),
    manual_boost_reason: "",
    editor_pick: item.editor_pick,
  };
}

function isEditDirty(item: TourismGeoRankedPlaceAdmin, edit: RankingEditState): boolean {
  const start = item.season_start_month == null ? "" : String(item.season_start_month);
  const end = item.season_end_month == null ? "" : String(item.season_end_month);
  return (
    edit.editorial_score !== String(item.editorial_score) ||
    edit.season_mode !== item.season_mode ||
    edit.season_start_month !== start ||
    edit.season_end_month !== end ||
    edit.manual_boost !== String(item.manual_boost) ||
    edit.editor_pick !== item.editor_pick
  );
}

function buildProposedFromEdit(edit: RankingEditState): {
  editorial_score: number;
  season_mode: TourismSeasonMode;
  season_start_month: number | null;
  season_end_month: number | null;
  manual_boost: number;
} | null {
  const editorialScore = Number(edit.editorial_score);
  const manualBoost = Number(edit.manual_boost);
  if (
    !Number.isInteger(editorialScore) ||
    !(TOURISM_EDITORIAL_SCORES as readonly number[]).includes(editorialScore)
  ) {
    return null;
  }
  if (!Number.isInteger(manualBoost) || manualBoost < -10 || manualBoost > 10) {
    return null;
  }
  const usesMonths =
    edit.season_mode === "best_months" || edit.season_mode === "poor_months";
  const parseMonth = (raw: string): number | null => {
    if (raw.trim() === "") return null;
    const month = Number(raw);
    return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
  };
  return {
    editorial_score: editorialScore,
    season_mode: edit.season_mode,
    season_start_month: usesMonths ? parseMonth(edit.season_start_month) : null,
    season_end_month: usesMonths ? parseMonth(edit.season_end_month) : null,
    manual_boost: manualBoost,
  };
}

function BreakdownRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 py-2 last:border-b-0">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
        {detail ? <div className="mt-0.5 text-xs text-gray-500">{detail}</div> : null}
      </div>
      <div className="text-sm font-medium tabular-nums text-gray-900">{value}</div>
    </div>
  );
}

export default function TourismRankingPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const scope = (searchParams.get("scope")?.trim() || "national") as TourismGeoRankingScope;
  const adminAreaId = searchParams.get("admin_area_id")?.trim() || "";
  const tourismType = searchParams.get("tourism_type")?.trim() || "";
  const selectedId = searchParams.get("place")?.trim() || "";
  const offset = Number(searchParams.get("offset") || "0") || 0;
  const [areaQuery, setAreaQuery] = useState("");
  const [edit, setEdit] = useState<RankingEditState | null>(null);
  const [debouncedEdit, setDebouncedEdit] = useState<RankingEditState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastPreviewBeforeSave, setLastPreviewBeforeSave] =
    useState<TourismRankingPreviewResponse | null>(null);

  const replaceFilters = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value == null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  const areasQuery = useQuery({
    queryKey: ["admin-area-options", "tourism-ranking", scope, areaQuery],
    queryFn: () =>
      getAdminAreaOptions({
        limit: 500,
        q: areaQuery || undefined,
        townshipOnly: scope === "township",
      }),
    enabled: scope === "township" || scope === "region",
  });

  const areaOptions = useMemo(() => {
    const rows = areasQuery.data ?? [];
    if (scope === "region") {
      return rows.filter((row) => REGION_LEVELS.has(row.admin_level_code.toLowerCase()));
    }
    return rows;
  }, [areasQuery.data, scope]);

  const rankingQuery = useQuery({
    queryKey: ["admin-tourism-geo-ranking", scope, adminAreaId, tourismType, offset],
    queryFn: ({ signal }) =>
      listAdminTourismGeoRanking(
        {
          scope,
          admin_area_id: scope === "national" ? undefined : adminAreaId || undefined,
          tourism_type: tourismType || undefined,
          limit: PAGE_SIZE,
          offset,
        },
        { signal },
      ),
    enabled: scope === "national" || Boolean(adminAreaId),
    placeholderData: keepPreviousData,
  });

  const typesQuery = useQuery({
    queryKey: ["tourism-types"],
    queryFn: ({ signal }) => listTourismTypes({ signal }),
  });

  const items = rankingQuery.data?.items ?? [];
  const selected = items.find((item) => item.public_id === selectedId) ?? null;
  const dirty = Boolean(selected && edit && isEditDirty(selected, edit));

  useEffect(() => {
    if (!selectedId && items[0]) {
      replaceFilters({ place: items[0].public_id });
    }
  }, [items, selectedId]);

  useEffect(() => {
    if (!selected) {
      setEdit(null);
      setDebouncedEdit(null);
      return;
    }
    if (dirty) return;
    const next = editStateFromItem(selected);
    setEdit(next);
    setDebouncedEdit(next);
  }, [selected, dirty]);

  useEffect(() => {
    if (!edit) return;
    const timer = window.setTimeout(() => setDebouncedEdit(edit), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [edit]);

  const profileQuery = useQuery({
    queryKey: ["tourism-moderation", "profile", selected?.public_id, "boost-audit"],
    enabled: Boolean(selected?.public_id),
    queryFn: ({ signal }) => getTourismPlaceProfile(selected!.public_id, { signal }),
  });

  const proposed = debouncedEdit ? buildProposedFromEdit(debouncedEdit) : null;

  const previewQuery = useQuery({
    queryKey: [
      "admin-tourism-ranking-preview",
      scope,
      adminAreaId,
      selected?.public_id,
      proposed,
    ],
    enabled:
      Boolean(selected?.public_id) &&
      (scope === "national" || Boolean(adminAreaId)) &&
      Boolean(proposed),
    queryFn: ({ signal }) =>
      previewAdminTourismRanking(
        {
          place_public_id: selected!.public_id,
          scope,
          admin_area_id: scope === "national" ? undefined : adminAreaId,
          proposed: dirty && proposed ? proposed : {},
        },
        { signal },
      ),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (previewQuery.data && dirty) {
      setLastPreviewBeforeSave(previewQuery.data);
    }
  }, [previewQuery.data, dirty]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !edit) throw new Error("Select an attraction first.");
      const editorialScore = Number(edit.editorial_score);
      if (
        !Number.isInteger(editorialScore) ||
        !(TOURISM_EDITORIAL_SCORES as readonly number[]).includes(editorialScore)
      ) {
        throw new Error("Select a valid editorial level.");
      }
      const manualBoost = Number(edit.manual_boost);
      if (!Number.isInteger(manualBoost) || manualBoost < -10 || manualBoost > 10) {
        throw new Error("Manual boost must be an integer from -10 to 10.");
      }
      if (manualBoost !== 0 && edit.manual_boost_reason.trim().length < 3) {
        throw new Error("A reason is required when manual boost is non-zero.");
      }

      const usesMonths =
        edit.season_mode === "best_months" || edit.season_mode === "poor_months";
      const parseMonth = (raw: string): number | null => {
        if (raw.trim() === "") return null;
        const month = Number(raw);
        return Number.isInteger(month) && month >= 1 && month <= 12 ? month : Number.NaN;
      };
      const seasonStart = usesMonths ? parseMonth(edit.season_start_month) : null;
      const seasonEnd = usesMonths ? parseMonth(edit.season_end_month) : null;
      if (
        Number.isNaN(seasonStart) ||
        Number.isNaN(seasonEnd) ||
        (seasonStart === null) !== (seasonEnd === null)
      ) {
        throw new Error("Select both season months, or leave both empty.");
      }

      const patch: {
        editorial_score?: TourismEditorialScore;
        season_mode?: TourismSeasonMode;
        season_start_month?: number | null;
        season_end_month?: number | null;
        manual_boost?: number;
        manual_boost_reason?: string;
        editor_pick?: boolean;
      } = {};
      if (editorialScore !== selected.editorial_score) {
        patch.editorial_score = editorialScore as TourismEditorialScore;
      }
      if (edit.season_mode !== selected.season_mode) {
        patch.season_mode = edit.season_mode;
      }
      if (seasonStart !== (selected.season_start_month ?? null)) {
        patch.season_start_month = seasonStart;
      }
      if (seasonEnd !== (selected.season_end_month ?? null)) {
        patch.season_end_month = seasonEnd;
      }
      if (manualBoost !== selected.manual_boost) {
        patch.manual_boost = manualBoost;
        if (manualBoost !== 0) {
          patch.manual_boost_reason = edit.manual_boost_reason.trim();
        }
      }
      if (edit.editor_pick !== selected.editor_pick) {
        patch.editor_pick = edit.editor_pick;
      }
      if (Object.keys(patch).length === 0) {
        throw new Error("No ranking changes to save.");
      }

      await updateTourismPlaceProfile(selected.public_id, patch);
      const savedPreview = await previewAdminTourismRanking({
        place_public_id: selected.public_id,
        scope,
        admin_area_id: scope === "national" ? undefined : adminAreaId,
        proposed: {},
      });
      return { savedPreview, expected: lastPreviewBeforeSave };
    },
    onSuccess: async ({ savedPreview, expected }) => {
      setError(null);
      const matched =
        !expected ||
        (expected.preview.rank === savedPreview.current.rank &&
          expected.preview.final_score === savedPreview.current.final_score);
      setToast(
        matched
          ? `Saved · rank #${savedPreview.current.rank ?? "—"} · score ${
              savedPreview.current.final_score?.toFixed(2) ?? "—"
            }`
          : `Saved with refreshed ranking (source signals changed). Now #${
              savedPreview.current.rank ?? "—"
            } · ${savedPreview.current.final_score?.toFixed(2) ?? "—"}`,
      );
      setLastPreviewBeforeSave(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-tourism-geo-ranking"] });
      await queryClient.invalidateQueries({
        queryKey: ["admin-tourism-ranking-preview"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["tourism-moderation", "profile", selected?.public_id],
      });
    },
    onError: (err) => {
      setToast(null);
      setError(permissionDeniedMessage(err));
    },
  });

  const needsArea = scope === "township" || scope === "region";
  const canLoad = scope === "national" || Boolean(adminAreaId);
  const showSeasonMonths =
    edit?.season_mode === "best_months" || edit?.season_mode === "poor_months";
  const boostAudits = profileQuery.data?.recent_manual_boost_audits ?? [];
  const preview = previewQuery.data;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Tourism ranking</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Admin preview of attraction ranking for township, region, or Myanmar. Edit editorial,
            season, Featured by CoreMap, and exceptional manual boost here. Factual tourism data
            stays on the Attraction form.
          </p>
        </div>
        <Link href={tourismPath("places")} className={SECONDARY_BTN}>
          Attractions
        </Link>
      </div>

      {toast ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {toast}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Scope
          </span>
          <select
            className={SELECT_CLASS}
            value={scope}
            onChange={(e) =>
              replaceFilters({
                scope: e.target.value,
                admin_area_id: null,
                place: null,
                offset: "0",
              })
            }
          >
            <option value="township">Township</option>
            <option value="region">Region</option>
            <option value="national">Myanmar</option>
          </select>
        </label>

        {needsArea ? (
          <label className="min-w-[16rem] flex-1 space-y-1 text-sm">
            <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
              {scope === "township" ? "Township" : "Region / state"}
            </span>
            <input
              className={`${SELECT_CLASS} mb-1 w-full`}
              placeholder="Filter areas…"
              value={areaQuery}
              onChange={(e) => setAreaQuery(e.target.value)}
            />
            <select
              className={`${SELECT_CLASS} w-full`}
              value={adminAreaId}
              onChange={(e) =>
                replaceFilters({
                  admin_area_id: e.target.value || null,
                  place: null,
                  offset: "0",
                })
              }
            >
              <option value="">Select {scope === "township" ? "township" : "region"}</option>
              {areaOptions.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name_en || area.canonical_name} ({area.admin_level_code})
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="space-y-1 text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Tourism type
          </span>
          <select
            className={SELECT_CLASS}
            value={tourismType}
            onChange={(e) =>
              replaceFilters({
                tourism_type: e.target.value || null,
                place: null,
                offset: "0",
              })
            }
          >
            <option value="">All attraction types</option>
            {(typesQuery.data?.items ?? []).map((type) => (
              <option key={type.code} value={type.code}>
                {type.name_en}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!canLoad ? (
        <p className="text-sm text-amber-800">
          Select a {scope === "township" ? "township" : "region"} to load the ranking.
        </p>
      ) : rankingQuery.isError ? (
        <p className="text-sm text-red-700">Could not load tourism ranking.</p>
      ) : rankingQuery.isLoading ? (
        <p className="text-sm text-gray-600">Loading ranking…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Ranking preview</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Attractions only · {rankingQuery.data?.algorithm_version} ·{" "}
                {rankingQuery.data?.total ?? 0} ranked
              </p>
            </div>
            <ul className="divide-y divide-gray-100">
              {items.map((item) => {
                const active = item.public_id === selected?.public_id;
                return (
                  <li key={item.public_id}>
                    <button
                      type="button"
                      onClick={() => replaceFilters({ place: item.public_id })}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${
                        active ? "bg-gray-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <span className="mt-0.5 w-10 shrink-0 text-sm font-semibold tabular-nums text-gray-900">
                        #{item.rank}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-gray-900">
                          {item.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-500">
                          {item.tourism_type_name_en || item.tourism_type}
                          {item.township_name ? ` · ${item.township_name}` : ""}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-2 text-xs text-gray-600">
                          <span>{ratingSummary(item)}</span>
                          <span>· {seasonLabel(item.season_mode)}</span>
                          {item.editor_pick ? (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
                              Featured
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs tabular-nums text-gray-500">
                        <span className="block font-medium text-gray-900">
                          {formatScore(item.final_score)}
                        </span>
                        final
                      </span>
                    </button>
                  </li>
                );
              })}
              {items.length === 0 ? (
                <li className="px-4 py-8 text-sm text-gray-500">
                  No ranked attractions in this scope.
                </li>
              ) : null}
            </ul>
            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 text-sm">
              <span className="text-gray-600">
                Showing {offset + 1}–
                {Math.min(offset + PAGE_SIZE, rankingQuery.data?.total ?? 0)} of{" "}
                {rankingQuery.data?.total ?? 0}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
                  disabled={offset <= 0}
                  onClick={() =>
                    replaceFilters({
                      offset: String(Math.max(0, offset - PAGE_SIZE)),
                      place: null,
                    })
                  }
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
                  disabled={offset + PAGE_SIZE >= (rankingQuery.data?.total ?? 0)}
                  onClick={() =>
                    replaceFilters({
                      offset: String(offset + PAGE_SIZE),
                      place: null,
                    })
                  }
                >
                  Next
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4">
            {!selected || !edit ? (
              <p className="text-sm text-gray-500">Select an attraction to manage ranking inputs.</p>
            ) : (
              <div className="space-y-5">
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Rank #{selected.rank}
                        {dirty ? (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
                            Unsaved
                          </span>
                        ) : null}
                      </p>
                      <h2 className="text-lg font-semibold text-gray-900">{selected.name}</h2>
                      <p className="mt-0.5 text-sm text-gray-600">
                        {selected.tourism_type_name_en || selected.tourism_type}
                        {selected.township_name ? ` · ${selected.township_name}` : ""}
                      </p>
                    </div>
                    <Link
                      href={tourismPath(`places/${selected.public_id}`)}
                      className={SECONDARY_BTN}
                    >
                      Edit Tourism Data
                    </Link>
                  </div>
                </div>

                {preview ? (
                  <div className="rounded-md border border-sky-100 bg-sky-50 px-3 py-3 text-sm text-sky-950">
                    <div className="font-semibold">Server preview</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-sky-800/80">
                          Current
                        </div>
                        <div className="mt-0.5 tabular-nums">
                          #{preview.current.rank ?? "—"} ·{" "}
                          {preview.current.final_score?.toFixed(2) ?? "excluded"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-sky-800/80">
                          Preview {dirty ? "(unsaved)" : ""}
                        </div>
                        <div className="mt-0.5 font-medium tabular-nums">
                          #{preview.preview.rank ?? "—"} ·{" "}
                          {preview.preview.final_score?.toFixed(2) ?? "excluded"}
                        </div>
                      </div>
                    </div>
                    {previewQuery.isFetching ? (
                      <p className="mt-2 text-xs text-sky-800/70">Updating preview…</p>
                    ) : null}
                    <p className="mt-2 text-xs text-sky-900/70">
                      Rank and score come from the API ranking service. This page does not calculate
                      final scores in the browser.
                    </p>
                  </div>
                ) : null}

                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Score breakdown</h3>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Authoritative {dirty ? "preview" : "current"} ·{" "}
                    {(dirty ? preview?.preview : preview?.current)?.algorithm_version ??
                      selected.algorithm_version}{" "}
                    · {selected.scope}
                  </p>
                  <div className="mt-2 rounded-md border border-gray-100 bg-gray-50 px-3">
                    {(() => {
                      const snap = dirty && preview ? preview.preview : selected;
                      const editorialScore =
                        "editorial_score" in snap ? snap.editorial_score : selected.editorial_score;
                      const editorialWeight =
                        "editorial_weight" in snap
                          ? snap.editorial_weight
                          : selected.editorial_weight;
                      const editorialContribution =
                        "editorial_contribution" in snap
                          ? snap.editorial_contribution
                          : selected.editorial_contribution;
                      const importanceScore =
                        "importance_score" in snap
                          ? snap.importance_score
                          : selected.importance_score;
                      const importanceWeight =
                        "importance_weight" in snap
                          ? snap.importance_weight
                          : selected.importance_weight;
                      const importanceContribution =
                        "importance_contribution" in snap
                          ? snap.importance_contribution
                          : selected.importance_contribution;
                      const reviewScore =
                        "review_score" in snap ? snap.review_score : selected.review_score;
                      const reviewWeight =
                        "review_weight" in snap ? snap.review_weight : selected.review_weight;
                      const reviewContribution =
                        "review_contribution" in snap
                          ? snap.review_contribution
                          : selected.review_contribution;
                      const popularityScore =
                        "popularity_score" in snap
                          ? snap.popularity_score
                          : selected.popularity_score;
                      const popularityWeight =
                        "popularity_weight" in snap
                          ? snap.popularity_weight
                          : selected.popularity_weight;
                      const popularityContribution =
                        "popularity_contribution" in snap
                          ? snap.popularity_contribution
                          : selected.popularity_contribution;
                      const baseScore =
                        "base_score" in snap ? snap.base_score : selected.base_score;
                      const seasonModifier =
                        "season_modifier" in snap
                          ? snap.season_modifier
                          : selected.season_modifier;
                      const manualBoost =
                        "manual_boost" in snap ? snap.manual_boost : selected.manual_boost;
                      const finalScore =
                        "final_score" in snap && snap.final_score != null
                          ? snap.final_score
                          : selected.final_score;
                      const rank =
                        dirty && preview?.preview.rank != null
                          ? preview.preview.rank
                          : selected.rank;
                      return (
                        <>
                          <BreakdownRow
                            label="Editorial"
                            detail={`${editorialScore} × ${pct(editorialWeight)} = ${formatScore(editorialContribution)}`}
                            value={formatScore(editorialContribution)}
                          />
                          <BreakdownRow
                            label="Importance"
                            detail={`${importanceScore} × ${pct(importanceWeight)} = ${formatScore(importanceContribution)}`}
                            value={formatScore(importanceContribution)}
                          />
                          <BreakdownRow
                            label="Reviews"
                            detail={`${formatScore(reviewScore)} × ${pct(reviewWeight)} = ${formatScore(reviewContribution)}`}
                            value={formatScore(reviewContribution)}
                          />
                          <BreakdownRow
                            label="Popularity"
                            detail={`${formatScore(popularityScore)} × ${pct(popularityWeight)} = ${formatScore(popularityContribution)}`}
                            value={formatScore(popularityContribution)}
                          />
                          <BreakdownRow label="Base" value={formatScore(baseScore)} />
                          <BreakdownRow
                            label="Season"
                            detail={seasonLabel(
                              dirty && edit ? edit.season_mode : selected.season_mode,
                            )}
                            value={`×${formatScore(seasonModifier)}`}
                          />
                          <BreakdownRow
                            label="Manual boost"
                            value={`${manualBoost >= 0 ? "+" : ""}${manualBoost}`}
                          />
                          <BreakdownRow label="Final" value={formatScore(finalScore)} />
                          <BreakdownRow label="Rank" value={`#${rank}`} />
                        </>
                      );
                    })()}
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900">Editable ranking inputs</h3>
                  <label className="block space-y-1 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Editorial level
                    </span>
                    <select
                      className={INPUT_CLASS}
                      value={edit.editorial_score}
                      onChange={(e) =>
                        setEdit((prev) =>
                          prev ? { ...prev, editorial_score: e.target.value } : prev,
                        )
                      }
                    >
                      {TOURISM_EDITORIAL_SCORES.map((score) => (
                        <option key={score} value={score}>
                          {editorialLevelLabel(score)} ({score})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Season
                    </span>
                    <select
                      className={INPUT_CLASS}
                      value={edit.season_mode}
                      onChange={(e) =>
                        setEdit((prev) =>
                          prev
                            ? {
                                ...prev,
                                season_mode: e.target.value as TourismSeasonMode,
                              }
                            : prev,
                        )
                      }
                    >
                      {SEASON_MODES.map((mode) => (
                        <option key={mode.code} value={mode.code}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {showSeasonMonths ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(["season_start_month", "season_end_month"] as const).map((field, index) => (
                        <label key={field} className="block space-y-1 text-sm">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {index === 0 ? "Start month" : "End month"}
                          </span>
                          <select
                            className={INPUT_CLASS}
                            value={edit[field]}
                            onChange={(e) =>
                              setEdit((prev) =>
                                prev ? { ...prev, [field]: e.target.value } : prev,
                              )
                            }
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

                  <label className="flex items-start gap-2 text-sm text-gray-800">
                    <input
                      type="checkbox"
                      checked={edit.editor_pick}
                      onChange={(e) =>
                        setEdit((prev) =>
                          prev ? { ...prev, editor_pick: e.target.checked } : prev,
                        )
                      }
                      className="mt-0.5 h-4 w-4 rounded border-gray-300"
                    />
                    <span>
                      <span className="font-medium">Featured by CoreMap</span>
                      <span className="mt-0.5 block text-xs text-gray-500">
                        Highlights this attraction in curated discovery. It does not directly set
                        rank.
                      </span>
                    </span>
                  </label>

                  <div className="rounded-md border border-amber-100 bg-amber-50/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                      Manual boost (exceptional only)
                    </p>
                    <p className="mt-1 text-xs text-amber-900/80">
                      Manual boost is an exceptional correction. Prefer Editorial level for normal
                      curation.
                    </p>
                    <div className="mt-2 grid gap-3 sm:grid-cols-[8rem_1fr]">
                      <label className="block space-y-1 text-sm">
                        <span className="text-xs text-gray-600">Boost (−10…10)</span>
                        <input
                          type="number"
                          min={-10}
                          max={10}
                          step={1}
                          className={INPUT_CLASS}
                          value={edit.manual_boost}
                          onChange={(e) =>
                            setEdit((prev) =>
                              prev ? { ...prev, manual_boost: e.target.value } : prev,
                            )
                          }
                        />
                      </label>
                      <label className="block space-y-1 text-sm">
                        <span className="text-xs text-gray-600">
                          Reason {Number(edit.manual_boost) !== 0 ? "(required)" : "(optional)"}
                        </span>
                        <input
                          type="text"
                          className={INPUT_CLASS}
                          value={edit.manual_boost_reason}
                          onChange={(e) =>
                            setEdit((prev) =>
                              prev
                                ? { ...prev, manual_boost_reason: e.target.value }
                                : prev,
                            )
                          }
                          placeholder="Why is this exceptional override needed?"
                        />
                      </label>
                    </div>
                    {boostAudits.length > 0 ? (
                      <div className="mt-3 space-y-1.5">
                        <p className="text-xs font-semibold text-amber-900">Recent boost history</p>
                        {boostAudits.map((row) => (
                          <div
                            key={`${row.created_at}-${row.manual_boost}-${row.reason ?? ""}`}
                            className="rounded border border-amber-100 bg-white px-2 py-1.5 text-xs text-gray-700"
                          >
                            <div className="font-medium text-gray-900">
                              {row.manual_boost == null
                                ? "Boost changed"
                                : `Boost ${row.manual_boost >= 0 ? "+" : ""}${row.manual_boost}`}
                              <span className="ml-2 font-normal text-gray-500">
                                {new Date(row.created_at).toLocaleString()}
                              </span>
                            </div>
                            {row.reason ? (
                              <div className="mt-0.5 text-gray-600">{row.reason}</div>
                            ) : (
                              <div className="mt-0.5 text-gray-400">No reason recorded</div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-amber-900/70">
                        No previous manual-boost audit rows for this attraction.
                      </p>
                    )}
                  </div>

                  <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    Read-only from CoreMap / reviews / popularity: importance, review score,
                    popularity, base, final, and rank. Rank is assigned after sorting — not editable.
                  </div>

                  <button
                    type="button"
                    className={PRIMARY_BTN}
                    disabled={saveMutation.isPending || !dirty}
                    onClick={() => {
                      setToast(null);
                      setError(null);
                      saveMutation.mutate();
                    }}
                  >
                    {saveMutation.isPending ? "Saving…" : "Save ranking inputs"}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
