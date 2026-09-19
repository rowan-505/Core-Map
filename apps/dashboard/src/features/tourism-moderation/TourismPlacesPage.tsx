"use client";

import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { tourismPath } from "@/src/lib/dashboardPaths";

import {
  listTourismPlacesRanking,
  listTourismTypes,
  updateTourismPlaceProfile,
} from "./api";
import {
  formatLocation,
  TOURISM_PLACE_MODES,
} from "./constants";
import {
  permissionDeniedMessage,
  popCursorPage,
  pushCursorPage,
} from "./filters";
import { buildEditorPickPatch } from "./profileForm";

const PAGE_SIZE = 20;
const SELECT_CLASS =
  "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const SECONDARY_BTN =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function TourismPlacesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const mode = searchParams.get("mode")?.trim() || "recommended";
  const tourismType = searchParams.get("tourism_type")?.trim() ?? "";
  const [typeDraft, setTypeDraft] = useState(tourismType);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingPickId, setPendingPickId] = useState<string | null>(null);
  const pageIndex = cursorStack.length - 1;
  const cursor = cursorStack[pageIndex] ?? null;

  useEffect(() => {
    setTypeDraft(tourismType);
  }, [tourismType]);

  useEffect(() => {
    setCursorStack([null]);
  }, [mode, tourismType]);

  const replaceFilters = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (!value) next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const listFilters = useMemo(
    () => ({
      mode,
      tourism_type: tourismType || undefined,
      cursor: cursor ?? undefined,
      limit: PAGE_SIZE,
    }),
    [mode, tourismType, cursor],
  );

  const query = useQuery({
    queryKey: ["tourism-moderation", "places", listFilters],
    queryFn: ({ signal }) => listTourismPlacesRanking(listFilters, { signal }),
    placeholderData: keepPreviousData,
  });
  const typesQuery = useQuery({
    queryKey: ["tourism", "types"],
    queryFn: ({ signal }) => listTourismTypes({ signal }),
    staleTime: 5 * 60 * 1000,
  });
  const typeNames = useMemo(
    () => new Map(typesQuery.data?.items.map((type) => [type.code, type.name_en]) ?? []),
    [typesQuery.data],
  );

  const editorPickMutation = useMutation({
    mutationFn: (input: { placeId: string; editorPick: boolean }) =>
      updateTourismPlaceProfile(input.placeId, buildEditorPickPatch(input.editorPick)),
    onMutate: (variables) => {
      setPendingPickId(variables.placeId);
    },
    onSuccess: async (_data, variables) => {
      setToast(
        variables.editorPick ? "Featured by CoreMap enabled" : "Featured by CoreMap removed",
      );
      await queryClient.invalidateQueries({ queryKey: ["tourism-moderation", "places"] });
    },
    onSettled: () => {
      setPendingPickId(null);
    },
  });

  const items = query.data?.items ?? [];
  const nextCursor = query.data?.next_cursor ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Attractions</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Browse public tourism profiles and edit overlays. Ranking list is API-backed and paginated.
            {" "}
            <Link href={tourismPath("candidates")} className="text-gray-900 underline">
              Candidates
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={tourismPath("places/new")} className={SECONDARY_BTN}>
            Create profile
          </Link>
          <button
            type="button"
            className={SECONDARY_BTN}
            disabled={query.isFetching}
            onClick={() => {
              void query.refetch();
            }}
          >
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {toast ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {toast}
        </div>
      ) : null}

      {editorPickMutation.isError ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {permissionDeniedMessage(editorPickMutation.error)}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {TOURISM_PLACE_MODES.map((option) => {
          const active = mode === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${
                active
                  ? "bg-gray-900 text-white ring-gray-900"
                  : "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50"
              }`}
              onClick={() => replaceFilters({ mode: option.id })}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <form
        className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          replaceFilters({ tourism_type: typeDraft.trim() || null });
        }}
      >
        <label className="space-y-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Tourism type
          </span>
          <select
            value={typeDraft}
            onChange={(e) => setTypeDraft(e.target.value)}
            className={`${SELECT_CLASS} min-w-48`}
            disabled={typesQuery.isLoading}
          >
            <option value="">All types</option>
            {typesQuery.data?.items.map((type) => (
              <option key={type.code} value={type.code}>
                {type.name_en} ({type.code})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={SECONDARY_BTN}>
          Apply filter
        </button>
      </form>
      {typesQuery.isError ? (
        <p className="text-sm text-red-700">
          Tourism type filters could not be loaded. Refresh to try again.
        </p>
      ) : null}

      {query.isLoading ? (
        <p className="text-sm text-gray-500">Loading tourism places…</p>
      ) : null}

      {query.isError ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {permissionDeniedMessage(query.error)}
        </div>
      ) : null}

      {!query.isLoading && !query.isError && items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-sm text-gray-600">
          No tourism places match these filters.
        </p>
      ) : null}

      {items.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Place</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Rating</th>
                <th className="px-4 py-3">Featured</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => {
                const pickBusy =
                  editorPickMutation.isPending && pendingPickId === item.public_id;
                return (
                  <tr key={item.public_id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{item.name}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-gray-500">
                        {item.public_id}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <span className="block">{typeNames.get(item.tourism_type) ?? "Unknown"}</span>
                      <span className="font-mono text-[11px] text-gray-500">
                        {item.tourism_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      {formatLocation(item.lat, item.lng)}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {item.average_rating === null
                        ? "—"
                        : `${item.average_rating} · ${item.published_review_count}`}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 disabled:opacity-50 ${
                          item.editor_pick
                            ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                            : "bg-white text-gray-600 ring-gray-200"
                        }`}
                        disabled={pickBusy}
                        onClick={() => {
                          if (pickBusy) return;
                          editorPickMutation.mutate({
                            placeId: item.public_id,
                            editorPick: !item.editor_pick,
                          });
                        }}
                      >
                        {pickBusy
                          ? "Saving…"
                          : item.editor_pick
                            ? "On"
                            : "Off"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={tourismPath(`places/${item.public_id}`)}
                        className="text-sm font-semibold text-gray-900 hover:underline"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          Page {pageIndex + 1}
          {nextCursor ? " · more available" : ""}
          {query.data?.mode ? ` · mode ${query.data.mode}` : ""}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className={SECONDARY_BTN}
            disabled={pageIndex === 0 || query.isFetching}
            onClick={() => setCursorStack((stack) => popCursorPage(stack))}
          >
            Previous
          </button>
          <button
            type="button"
            className={SECONDARY_BTN}
            disabled={!nextCursor || query.isFetching}
            onClick={() =>
              setCursorStack((stack) => pushCursorPage(stack, nextCursor))
            }
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
