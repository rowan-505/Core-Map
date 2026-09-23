"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Geometry } from "geojson";
import type { Map as MaplibreMap } from "maplibre-gl";

import AdminAreaBoundaryReviewHost from "@/src/features/admin-area-boundary-review/AdminAreaBoundaryReviewHost";
import BoundaryReviewControls from "@/src/features/admin-area-boundary-review/BoundaryReviewControls";
import {
    DEFAULT_BOUNDARY_REVIEW_TOGGLES,
    type BoundaryReviewToggles,
} from "@/src/features/admin-area-boundary-review/types";
import { coreReviewPath } from "@/src/lib/dashboardPaths";
import { isAbortError } from "@/src/lib/api";

import {
    getAdminGeographyDetail,
    getAdminGeographySummary,
    listAdminGeography,
    listAdminGeographyChildren,
    listAdminGeographyPostalCodes,
    searchPostalCodes,
    wouldFetchNationwideGeoJson,
} from "./api";
import AdminGeographyGeometryEditor from "./AdminGeographyGeometryEditor";
import AdminGeographyMap from "./AdminGeographyMap";
import AdminGeographyRemediationPanel from "./AdminGeographyRemediationPanel";
import {
    ADMIN_GEOGRAPHY_FILTER_CHIPS,
    defaultFiltersForMode,
    filtersToListParams,
    filtersToTileFilters,
    geographyErrorMessage,
    isPermissionDeniedError,
    looksLikePostalQuery,
    toggleFilterChip,
} from "./filters";
import {
    geometrySourceBadgeClass,
    postalMatchBadgeClass,
    verificationBadgeClass,
} from "./mapStyles";
import { NeedsFixReasonBanner } from "./NeedsFixReasonBanner";
import type {
    AdminGeographyFilterKey,
    AdminGeographyListItem,
    AdminGeographyMode,
} from "./types";

const PAGE_SIZE = 40;
const INPUT =
    "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900";
const CHIP =
    "rounded-md border px-2 py-1 text-xs font-medium transition-colors";
const CHIP_ON = "border-slate-900 bg-slate-900 text-white";
const CHIP_OFF = "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";

function Counter({
    label,
    value,
    target,
}: {
    label: string;
    value: number;
    target?: number;
}) {
    return (
        <div className="min-w-[8rem] rounded-md border border-slate-200 bg-white px-3 py-2">
            <div className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {label}
            </div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums leading-none text-slate-900">
                {value.toLocaleString()}
                {target !== undefined ? (
                    <span className="text-xs font-normal text-slate-500">
                        {" "}
                        / {target}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

function readMode(raw: string | null): AdminGeographyMode {
    return raw === "mimu-remediation" ? "mimu-remediation" : "browse";
}

export default function AdminGeographyPage() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const mode = readMode(searchParams.get("mode"));
    const remediationMode = mode === "mimu-remediation";

    const [activeFilters, setActiveFilters] = useState<Set<AdminGeographyFilterKey>>(() =>
        defaultFiltersForMode(mode),
    );
    const [searchDraft, setSearchDraft] = useState("");
    const [q, setQ] = useState("");
    const [offset, setOffset] = useState(0);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editingGeometry, setEditingGeometry] = useState(false);
    const [draftGeometry, setDraftGeometry] = useState<{
        type: "Polygon" | "MultiPolygon";
        coordinates: unknown;
    } | null>(null);
    const [mapInstance, setMapInstance] = useState<MaplibreMap | null>(null);
    const [boundaryToggles, setBoundaryToggles] = useState<BoundaryReviewToggles>(
        DEFAULT_BOUNDARY_REVIEW_TOGGLES,
    );
    const boundaryCheckRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        setActiveFilters(defaultFiltersForMode(mode));
        setOffset(0);
        setSelectedId(null);
        setEditingGeometry(false);
        setDraftGeometry(null);
    }, [mode]);

    const setMode = useCallback(
        (next: AdminGeographyMode) => {
            const params = new URLSearchParams(searchParams.toString());
            if (next === "browse") {
                params.delete("mode");
            } else {
                params.set("mode", next);
            }
            const qs = params.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname);
        },
        [pathname, router, searchParams],
    );

    const selectArea = useCallback((id: string | null) => {
        setSelectedId(id);
        setEditingGeometry(false);
        setDraftGeometry(null);
    }, []);

    const listParams = useMemo(
        () => filtersToListParams(activeFilters, { q, limit: PAGE_SIZE, offset }),
        [activeFilters, q, offset],
    );
    const tileFilters = useMemo(() => filtersToTileFilters(activeFilters), [activeFilters]);
    const settlementsMode = "kind" in listParams;

    const summaryQuery = useQuery({
        queryKey: ["admin-geography", "summary"],
        queryFn: ({ signal }) => getAdminGeographySummary({ signal }),
        staleTime: 60_000,
    });

    const listQuery = useQuery({
        queryKey: ["admin-geography", "list", listParams],
        queryFn: async ({ signal }) => {
            if ("kind" in listParams) {
                return { items: [] as AdminGeographyListItem[], total: 0, limit: PAGE_SIZE, offset: 0 };
            }
            // Guard: list path must never request nationwide GeoJSON.
            const pathProbe = `/admin-areas?limit=${listParams.limit}`;
            if (wouldFetchNationwideGeoJson(pathProbe)) {
                throw new Error("Refusing nationwide GeoJSON list fetch");
            }
            if (q && looksLikePostalQuery(q)) {
                const postal = await searchPostalCodes({ q, limit: 20, signal });
                const ids = new Set<string>();
                for (const row of postal.items) {
                    if (row.local_admin_area_id) ids.add(row.local_admin_area_id);
                    if (row.township_admin_area_id) ids.add(row.township_admin_area_id);
                }
                if (ids.size === 0) {
                    return { items: [], total: 0, limit: PAGE_SIZE, offset: 0 };
                }
                // Resolve first linked admin area pages via numeric id search (paginated).
                const firstId = [...ids][0]!;
                return listAdminGeography({ ...listParams, q: firstId }, { signal });
            }
            return listAdminGeography(listParams, { signal });
        },
        placeholderData: keepPreviousData,
        enabled: !settlementsMode,
    });

    const detailQuery = useQuery({
        queryKey: ["admin-geography", "detail", selectedId],
        queryFn: ({ signal }) => {
            if (!selectedId) throw new Error("missing id");
            // Fit uses bbox from list; full geometry is one selected feature only.
            return getAdminGeographyDetail(selectedId, { includeGeometry: true, signal });
        },
        enabled: Boolean(selectedId),
    });

    const childrenQuery = useQuery({
        queryKey: ["admin-geography", "children", selectedId],
        queryFn: ({ signal }) =>
            listAdminGeographyChildren(selectedId!, { limit: 50, signal }),
        enabled: Boolean(selectedId),
    });

    const postalQuery = useQuery({
        queryKey: ["admin-geography", "postal", selectedId],
        queryFn: ({ signal }) =>
            listAdminGeographyPostalCodes(selectedId!, { limit: 10, signal }),
        enabled: Boolean(selectedId),
    });

    const items = listQuery.data?.items ?? [];
    const total = listQuery.data?.total ?? 0;
    const selectedFromList = items.find((i) => i.id === selectedId) ?? null;
    const detail = detailQuery.data ?? null;

    const onToggle = useCallback((key: AdminGeographyFilterKey) => {
        setActiveFilters((prev) => toggleFilterChip(prev, key));
        setOffset(0);
        selectArea(null);
    }, [selectArea]);

    const onSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setQ(searchDraft.trim());
        setOffset(0);
        selectArea(null);
    };

    const permissionDenied =
        isPermissionDeniedError(summaryQuery.error) ||
        isPermissionDeniedError(listQuery.error);

    const listError =
        listQuery.error && !isAbortError(listQuery.error)
            ? geographyErrorMessage(listQuery.error)
            : null;

    return (
        <div className="absolute inset-0 flex flex-col overflow-hidden bg-slate-100">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
                <div>
                    <h1 className="text-base font-semibold text-slate-900">Admin geography</h1>
                    <p className="text-xs text-slate-500">
                        {remediationMode
                            ? "MIMU → owned: edit geometry, optional evidence, Apply as owned."
                            : "Read-only browser — vector tiles for the map, paginated metadata for the list."}
                    </p>
                </div>
                <div className="flex gap-1 rounded-md border border-slate-200 p-0.5">
                    <button
                        type="button"
                        className={`${CHIP} ${!remediationMode ? CHIP_ON : CHIP_OFF}`}
                        onClick={() => setMode("browse")}
                    >
                        Browse
                    </button>
                    <button
                        type="button"
                        className={`${CHIP} ${remediationMode ? CHIP_ON : CHIP_OFF}`}
                        onClick={() => setMode("mimu-remediation")}
                    >
                        MIMU remediation
                    </button>
                </div>
                <div className="ml-auto flex flex-wrap gap-1.5">
                    {summaryQuery.isLoading ? (
                        <span className="text-xs text-slate-500">Loading counters…</span>
                    ) : summaryQuery.data ? (
                        <>
                            <Counter
                                label="Official 1st-level"
                                value={summaryQuery.data.official_first_level}
                                target={summaryQuery.data.targets.official_first_level}
                            />
                            <Counter
                                label="Official townships"
                                value={summaryQuery.data.official_township}
                                target={summaryQuery.data.targets.official_township}
                            />
                            <Counter label="Wards" value={summaryQuery.data.ward_count} />
                            <Counter
                                label="Village tracts"
                                value={summaryQuery.data.village_tract_count}
                            />
                            <Counter
                                label="Settlements"
                                value={summaryQuery.data.settlement_count}
                            />
                            <Counter
                                label="MIMU placeholders"
                                value={summaryQuery.data.placeholder_count}
                            />
                            <Counter
                                label="Postal local"
                                value={summaryQuery.data.postal_linked_local}
                            />
                            <Counter
                                label="Postal township"
                                value={summaryQuery.data.postal_linked_township_only}
                            />
                            <Counter
                                label="Postal review"
                                value={summaryQuery.data.postal_unmatched_review}
                            />
                        </>
                    ) : summaryQuery.isError ? (
                        <span className="text-xs text-red-700">
                            {geographyErrorMessage(summaryQuery.error)}
                        </span>
                    ) : null}
                </div>
            </div>

            {permissionDenied ? (
                <div className="m-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                    You do not have permission to view admin geography. Dashboard access is required.
                </div>
            ) : null}

            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)_22rem]">
                {/* Sidebar filters + list */}
                <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
                    <form onSubmit={onSearchSubmit} className="space-y-2 border-b border-slate-100 p-3">
                        <label className="block text-xs font-medium text-slate-600">
                            Search
                            <input
                                className={`${INPUT} mt-1`}
                                value={searchDraft}
                                onChange={(e) => setSearchDraft(e.target.value)}
                                placeholder="ID, public_id, name, alias, postal…"
                            />
                        </label>
                        <button
                            type="submit"
                            className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
                        >
                            Search
                        </button>
                    </form>

                    <div className="max-h-64 space-y-3 overflow-y-auto border-b border-slate-100 p-3">
                        {(["level", "type", "flag", "decision", "evidence"] as const).map((group) => {
                            if (!remediationMode && (group === "decision" || group === "evidence")) {
                                return null;
                            }
                            return (
                            <div key={group} className="space-y-1.5">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                    {group === "level"
                                        ? "Level"
                                        : group === "type"
                                          ? "Type"
                                          : group === "flag"
                                            ? "Flags"
                                            : group === "decision"
                                              ? "Rejected"
                                              : "Evidence"}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {ADMIN_GEOGRAPHY_FILTER_CHIPS.filter((c) => c.group === group).map(
                                        (chip) => (
                                            <button
                                                key={chip.key}
                                                type="button"
                                                className={`${CHIP} ${
                                                    activeFilters.has(chip.key) ? CHIP_ON : CHIP_OFF
                                                }`}
                                                onClick={() => onToggle(chip.key)}
                                            >
                                                {chip.label}
                                            </button>
                                        ),
                                    )}
                                </div>
                            </div>
                            );
                        })}
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col">
                        <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-500">
                            <span>
                                {settlementsMode
                                    ? "Settlements"
                                    : listQuery.isFetching
                                      ? "Loading…"
                                      : `${total.toLocaleString()} results`}
                            </span>
                            <span>
                                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)}
                            </span>
                        </div>

                        {settlementsMode ? (
                            <div className="m-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                                Villages/settlements live in{" "}
                                <Link
                                    className="font-medium text-sky-800 underline"
                                    href={coreReviewPath("settlements")}
                                >
                                    core settlements
                                </Link>
                                , not admin-area polygons. This map does not download the full
                                57k-point set as GeoJSON — use the settlements review page.
                            </div>
                        ) : null}

                        {listError ? (
                            <div className="m-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                                {listError}
                            </div>
                        ) : null}

                        {!settlementsMode && !listQuery.isLoading && items.length === 0 && !listError ? (
                            <div className="m-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                                No admin areas match these filters.
                            </div>
                        ) : null}

                        <ul className="min-h-0 flex-1 overflow-y-auto">
                            {items.map((row) => {
                                const selected = row.id === selectedId;
                                return (
                                    <li key={row.id}>
                                        <button
                                            type="button"
                                            onClick={() => selectArea(row.id)}
                                            className={`w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50 ${
                                                selected ? "bg-sky-50" : ""
                                            }`}
                                        >
                                            <div className="break-words text-sm font-medium leading-snug text-slate-900">
                                                {row.canonical_name}
                                            </div>
                                            <div className="mt-1 flex flex-wrap gap-1 text-[10px] leading-tight">
                                                <span className="rounded border border-slate-200 px-1.5 py-0.5 text-slate-600">
                                                    {row.admin_level_code}
                                                </span>
                                                {row.admin_area_type_code ? (
                                                    <span className="rounded border border-slate-200 px-1.5 py-0.5 text-slate-600">
                                                        {row.admin_area_type_code}
                                                    </span>
                                                ) : null}
                                                <span
                                                    className={`rounded border px-1.5 py-0.5 ${verificationBadgeClass(row.verification_status)}`}
                                                >
                                                    {row.verification_status}
                                                </span>
                                                {row.geometry_source === "mimu_placeholder" ? (
                                                    <span
                                                        className={`rounded border px-1.5 py-0.5 ${geometrySourceBadgeClass(row.geometry_source)}`}
                                                    >
                                                        MIMU placeholder
                                                    </span>
                                                ) : null}
                                            </div>
                                            <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                                                #{row.id}
                                            </div>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>

                        <div className="flex gap-2 border-t border-slate-100 p-2">
                            <button
                                type="button"
                                disabled={offset <= 0}
                                className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
                                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                            >
                                Previous
                            </button>
                            <button
                                type="button"
                                disabled={offset + PAGE_SIZE >= total}
                                className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
                                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                </aside>

                {/* Map */}
                <section className="relative flex min-h-[20rem] min-w-0 flex-col lg:min-h-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-2 py-1.5">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                            Boundary review
                        </span>
                        <BoundaryReviewControls
                            toggles={boundaryToggles}
                            onTogglesChange={setBoundaryToggles}
                            onCheckGeometry={() => boundaryCheckRef.current?.()}
                            palette="core"
                        />
                    </div>
                    <div className="relative min-h-0 flex-1">
                        <AdminGeographyMap
                            tileFilters={tileFilters}
                            selectedId={selectedId}
                            selectedBbox={
                                (detail?.bbox as [number, number, number, number] | null | undefined) ??
                                (selectedFromList?.bbox as [number, number, number, number] | null | undefined) ??
                                null
                            }
                            selectedGeometry={null}
                            onSelectFeatureId={(id) => {
                                if (editingGeometry || draftGeometry) {
                                    const ok = window.confirm(
                                        "You have unsaved geometry edits. Switch area and discard the draft?",
                                    );
                                    if (!ok) return;
                                    setEditingGeometry(false);
                                    setDraftGeometry(null);
                                }
                                selectArea(id);
                            }}
                            onMapReady={setMapInstance}
                            suppressFitBounds={editingGeometry}
                        />
                        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-slate-200 bg-white/90 px-2 py-1 text-[10px] text-slate-600 shadow-sm">
                            Vector tiles only · no nationwide GeoJSON
                        </div>
                    </div>
                    {selectedId && detail?.public_id ? (
                        <div className="border-t border-slate-200 bg-white p-2">
                            <AdminAreaBoundaryReviewHost
                                publicId={detail.public_id}
                                map={mapInstance}
                                draftGeometry={
                                    (draftGeometry as Geometry | null) ??
                                    (detail.geometry as Geometry | null) ??
                                    null
                                }
                                hasUnsavedEdits={Boolean(editingGeometry || draftGeometry)}
                                canonicalName={detail.canonical_name}
                                showInlineControls={false}
                                toggles={boundaryToggles}
                                onTogglesChange={setBoundaryToggles}
                                checkGeometryRef={boundaryCheckRef}
                                onOpenNeighbour={({ numericId }) => {
                                    selectArea(numericId);
                                }}
                            />
                        </div>
                    ) : null}
                </section>

                {/* Detail */}
                <aside className="flex min-h-0 flex-col overflow-y-auto border-l border-slate-200 bg-white">
                    {!selectedId ? (
                        <div className="p-4 text-sm text-slate-500">
                            Select an area from the list or map to see details, ancestors, children,
                            and postal linkage.
                        </div>
                    ) : detailQuery.isLoading ? (
                        <div className="p-4 text-sm text-slate-500">Loading detail…</div>
                    ) : detailQuery.isError ? (
                        <div className="m-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                            {geographyErrorMessage(detailQuery.error)}
                        </div>
                    ) : detail ? (
                        <div className="space-y-4 p-4">
                            <div>
                                <h2 className="text-lg font-semibold leading-snug text-slate-900">
                                    {detail.canonical_name}
                                </h2>
                                <p className="mt-1 font-mono text-xs text-slate-500">
                                    #{detail.id} · {detail.public_id}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    <span
                                        className={`rounded border px-1.5 py-0.5 text-[10px] leading-tight ${verificationBadgeClass(detail.verification_status)}`}
                                    >
                                        {detail.verification_status}
                                    </span>
                                    <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] leading-tight text-slate-700">
                                        {detail.is_official_boundary ? "official" : "reference"}
                                    </span>
                                    <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] leading-tight text-slate-700">
                                        {detail.is_public_usable ? "public" : "non-public"}
                                    </span>
                                    {detail.geometry_source ? (
                                        <span
                                            className={`rounded border px-1.5 py-0.5 text-[10px] leading-tight ${geometrySourceBadgeClass(detail.geometry_source)}`}
                                        >
                                            {detail.geometry_source === "mimu_placeholder"
                                                ? "MIMU placeholder"
                                                : detail.geometry_source}
                                        </span>
                                    ) : null}
                                    {detail.source_license_status ? (
                                        <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] leading-tight text-slate-700">
                                            licence: {detail.source_license_status}
                                        </span>
                                    ) : null}
                                    {detail.remediation_decision ? (
                                        <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] leading-tight text-amber-950">
                                            {detail.remediation_decision}
                                        </span>
                                    ) : null}
                                    <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] leading-tight text-red-800">
                                        eligible: {detail.public_eligible ? "yes" : "no"}
                                    </span>
                                </div>
                            </div>

                            <NeedsFixReasonBanner
                                status={detail.verification_status}
                                note={detail.verification_note}
                            />

                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div className="rounded-md border border-slate-200 p-2">
                                    <div className="text-[10px] uppercase text-slate-500">Children</div>
                                    <div className="font-semibold">{detail.child_count}</div>
                                </div>
                                <div className="rounded-md border border-slate-200 p-2">
                                    <div className="text-[10px] uppercase text-slate-500">
                                        Postal codes
                                    </div>
                                    <div className="font-semibold">{detail.postal_count}</div>
                                </div>
                            </div>

                            {remediationMode ? (
                                <>
                                    {editingGeometry ? (
                                        <AdminGeographyGeometryEditor
                                            detail={detail}
                                            map={mapInstance}
                                            onCancel={() => setEditingGeometry(false)}
                                            onKeepDraft={(geometry) => {
                                                setDraftGeometry(geometry);
                                                setEditingGeometry(false);
                                            }}
                                        />
                                    ) : (
                                        <button
                                            type="button"
                                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                                            onClick={() => setEditingGeometry(true)}
                                            disabled={!detail.geometry && !detail.bbox}
                                        >
                                            {draftGeometry
                                                ? "Edit geometry draft"
                                                : "1. Edit geometry"}
                                        </button>
                                    )}
                                    <AdminGeographyRemediationPanel
                                        key={detail.id}
                                        detail={detail}
                                        draftGeometry={draftGeometry}
                                        onResetDraft={() => {
                                            const geom = detail.geometry as
                                                | { type?: string; coordinates?: unknown }
                                                | null;
                                            if (
                                                geom?.type === "Polygon" ||
                                                geom?.type === "MultiPolygon"
                                            ) {
                                                setDraftGeometry({
                                                    type: geom.type,
                                                    coordinates: geom.coordinates,
                                                });
                                            } else {
                                                setDraftGeometry(null);
                                            }
                                        }}
                                        onSaved={() => {
                                            setDraftGeometry(null);
                                            setEditingGeometry(false);
                                            void detailQuery.refetch();
                                            void listQuery.refetch();
                                            void summaryQuery.refetch();
                                        }}
                                    />
                                </>
                            ) : (
                                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                    Browse mode is read-only for geometry. Switch to{" "}
                                    <button
                                        type="button"
                                        className="font-medium text-sky-800 underline"
                                        onClick={() => setMode("mimu-remediation")}
                                    >
                                        MIMU remediation
                                    </button>{" "}
                                    to edit placeholders and attach evidence.
                                </p>
                            )}

                            {detail.names.length > 0 ? (
                                <div>
                                    <h3 className="text-xs font-semibold uppercase text-slate-500">
                                        Names
                                    </h3>
                                    <ul className="mt-1 space-y-1 text-sm">
                                        {detail.names.map((n) => (
                                            <li key={n.id} className="text-slate-800">
                                                {n.name}
                                                <span className="ml-1 text-xs text-slate-400">
                                                    {n.language_code ?? "—"} · {n.name_type}
                                                    {n.is_primary ? " · primary" : ""}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}

                            <div>
                                <h3 className="text-xs font-semibold uppercase text-slate-500">
                                    Ancestors
                                </h3>
                                {detail.ancestors.length === 0 ? (
                                    <p className="mt-1 text-sm text-slate-500">None</p>
                                ) : (
                                    <ol className="mt-1 space-y-1">
                                        {detail.ancestors.map((a) => (
                                            <li key={a.id}>
                                                <button
                                                    type="button"
                                                    className="text-sm text-sky-800 hover:underline"
                                                    onClick={() => selectArea(a.id)}
                                                >
                                                    {a.canonical_name}
                                                </button>
                                                <span className="ml-1 text-xs text-slate-400">
                                                    {a.admin_level_code}
                                                </span>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </div>

                            <div>
                                <h3 className="text-xs font-semibold uppercase text-slate-500">
                                    Children
                                </h3>
                                {childrenQuery.isLoading ? (
                                    <p className="mt-1 text-sm text-slate-500">Loading…</p>
                                ) : (childrenQuery.data?.items.length ?? 0) === 0 ? (
                                    <p className="mt-1 text-sm text-slate-500">None</p>
                                ) : (
                                    <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto">
                                        {childrenQuery.data!.items.map((c) => (
                                            <li key={c.id}>
                                                <button
                                                    type="button"
                                                    className="text-sm text-sky-800 hover:underline"
                                                    onClick={() => selectArea(c.id)}
                                                >
                                                    {c.canonical_name}
                                                </button>
                                                <span className="ml-1 text-xs text-slate-400">
                                                    {c.admin_level_code}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                            <div>
                                <h3 className="text-xs font-semibold uppercase text-slate-500">
                                    Postal linkage
                                </h3>
                                {postalQuery.isLoading ? (
                                    <p className="mt-1 text-sm text-slate-500">Loading…</p>
                                ) : (postalQuery.data?.items.length ?? 0) === 0 ? (
                                    <p className="mt-1 text-sm text-slate-500">
                                        No linked postal codes ({detail.postal_count} total)
                                    </p>
                                ) : (
                                    <ul className="mt-1 space-y-1">
                                        {postalQuery.data!.items.map((p) => (
                                            <li
                                                key={p.postal_code}
                                                className="flex items-center justify-between gap-2 text-sm"
                                            >
                                                <span className="font-mono">{p.postal_code}</span>
                                                <span
                                                    className={`rounded border px-1 text-[10px] ${postalMatchBadgeClass(p.match_status)}`}
                                                >
                                                    {p.match_status}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                            <Link
                                href={coreReviewPath(`admin-areas/${detail.id}/edit`)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block text-sm font-medium text-sky-800 hover:underline"
                            >
                                Open in core review →
                            </Link>
                        </div>
                    ) : null}
                </aside>
            </div>
        </div>
    );
}
