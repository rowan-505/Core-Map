"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import CoreReviewConfirmDialog from "@/src/features/core-review/lifecycle/CoreReviewConfirmDialog";
import CoreReviewMapPreview from "@/src/components/core-review/CoreReviewMapPreview";
import { isAbortError } from "@/src/lib/api";

import { isLocalBasemapAdminUiEnabled } from "./isLocalBasemapAdminUiEnabled";
import {
    actionsForLifecycleState,
    lifecycleStateLabel,
    type LocalBasemapAction,
} from "./localBasemapActions";
import {
    fetchLocalBasemapFeature,
    fetchLocalBasemapStatus,
    runLocalBasemapAction,
    searchLocalBasemapFeatures,
    type LocalBasemapEntity,
    type LocalBasemapFeatureDetail,
    type LocalBasemapSearchHit,
} from "./localBasemapApi";

type Banner =
    | { tone: "success" | "warning" | "error" | "info"; message: string; dependencies?: string[] }
    | null;

function geometrySourceBadgeClass(source: string | null | undefined): string {
    switch (source) {
        case "core":
            return "bg-emerald-100 text-emerald-900 border-emerald-300";
        case "archive":
            return "bg-amber-100 text-amber-900 border-amber-300";
        case "base":
            return "bg-sky-100 text-sky-900 border-sky-300";
        default:
            return "bg-slate-100 text-slate-700 border-slate-300";
    }
}

export default function LocalBasemapPage() {
    const enabled = isLocalBasemapAdminUiEnabled();
    const [entity, setEntity] = useState<LocalBasemapEntity>("buildings");
    const [query, setQuery] = useState("");
    const [hits, setHits] = useState<LocalBasemapSearchHit[]>([]);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [detail, setDetail] = useState<LocalBasemapFeatureDetail | null>(null);
    const [loadingSearch, setLoadingSearch] = useState(false);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [busyAction, setBusyAction] = useState<LocalBasemapAction | null>(null);
    const [banner, setBanner] = useState<Banner>(null);
    const [bridgeOk, setBridgeOk] = useState<boolean | null>(null);
    const [deleteOpen, setDeleteOpen] = useState(false);

    useEffect(() => {
        if (!enabled) {
            return;
        }
        const ac = new AbortController();
        fetchLocalBasemapStatus(ac.signal)
            .then(() => setBridgeOk(true))
            .catch(() => setBridgeOk(false));
        return () => ac.abort();
    }, [enabled]);

    const refreshDetail = useCallback(async (featureKey: string) => {
        setLoadingDetail(true);
        try {
            const next = await fetchLocalBasemapFeature(entity, featureKey, undefined, {
                includeGeometry: true,
            });
            setDetail(next);
        } catch (error) {
            if (!isAbortError(error)) {
                setDetail(null);
                setBanner({
                    tone: "error",
                    message: error instanceof Error ? error.message : "Failed to load feature.",
                });
            }
        } finally {
            setLoadingDetail(false);
        }
    }, [entity]);

    useEffect(() => {
        setSelectedKey(null);
        setDetail(null);
        setHits([]);
        setBanner(null);
    }, [entity]);

    useEffect(() => {
        if (!enabled || !selectedKey) {
            return;
        }
        void refreshDetail(selectedKey);
    }, [enabled, selectedKey, refreshDetail]);

    async function onSearch(e: React.FormEvent) {
        e.preventDefault();
        const q = query.trim();
        if (!q) {
            return;
        }
        setLoadingSearch(true);
        setBanner(null);
        try {
            const result = await searchLocalBasemapFeatures(entity, q);
            setHits(result.items);
            if (result.items.length === 1) {
                setSelectedKey(result.items[0]!.feature_key);
            }
        } catch (error) {
            setHits([]);
            setBanner({
                tone: "error",
                message: error instanceof Error ? error.message : "Search failed.",
            });
        } finally {
            setLoadingSearch(false);
        }
    }

    const visibleActions = useMemo(() => {
        if (!detail) {
            return [] as LocalBasemapAction[];
        }
        return detail.available_actions?.length
            ? detail.available_actions
            : actionsForLifecycleState(detail.lifecycle_state);
    }, [detail]);

    async function runAction(action: LocalBasemapAction) {
        if (!detail) {
            return;
        }
        setBusyAction(action);
        setBanner(null);
        try {
            const result = await runLocalBasemapAction(entity, action, detail.feature_key);
            if (result.detail) {
                setDetail(result.detail);
            } else {
                await refreshDetail(detail.feature_key);
            }
            if (!result.ok) {
                setBanner({
                    tone: "error",
                    message: result.message,
                    dependencies: result.dependencies?.map(
                        (d) => `${d.code}: ${d.message} (${d.count})`
                    ),
                });
            } else if (result.sync_stale) {
                setBanner({ tone: "warning", message: result.message });
            } else {
                setBanner({ tone: "success", message: result.message });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : "Action failed.";
            setBanner({
                tone: "error",
                message,
            });
            await refreshDetail(detail.feature_key);
        } finally {
            setBusyAction(null);
            setDeleteOpen(false);
        }
    }

    if (!enabled) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
                    Local Basemap admin is unavailable. It only runs on local Windows/WSL development
                    with <code className="text-xs">NEXT_PUBLIC_ENABLE_LOCAL_BASEMAP_ADMIN=true</code>{" "}
                    and is hidden in production builds.
                </div>
            </main>
        );
    }

    return (
        <main className="p-6">
            <div className="mx-auto flex max-w-6xl flex-col gap-4">
                <header>
                    <h1 className="text-xl font-semibold text-slate-900">Local Basemap</h1>
                    <p className="mt-1 text-sm text-slate-600">
                        Windows/WSL hybrid basemap lifecycle (Base → Core → Archive → Delete). Calls
                        the local API bridge only — never the PostgreSQL port from the browser.
                    </p>
                    {bridgeOk === false ? (
                        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            API local-basemap bridge is not enabled. Set{" "}
                            <code className="text-xs">ENABLE_LOCAL_BASEMAP_ADMIN=true</code> and{" "}
                            <code className="text-xs">LOCAL_TILE_DATABASE_URL</code> on the API, then
                            restart.
                        </p>
                    ) : null}
                </header>

                <div className="flex gap-2 border-b border-slate-200 pb-2">
                    {(
                        [
                            ["buildings", "Buildings"],
                            ["land", "Land"],
                        ] as const
                    ).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setEntity(value)}
                            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                                entity === value
                                    ? "bg-slate-900 text-white"
                                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                <form onSubmit={onSearch} className="flex flex-wrap gap-2">
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="feature_key, OSM id, or name"
                        className="min-w-[16rem] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button
                        type="submit"
                        disabled={loadingSearch}
                        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                        {loadingSearch ? "Searching…" : "Search"}
                    </button>
                </form>

                {banner ? (
                    <div
                        className={`rounded-md border px-3 py-2 text-sm ${
                            banner.tone === "success"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                : banner.tone === "warning"
                                  ? "border-amber-200 bg-amber-50 text-amber-950"
                                  : banner.tone === "error"
                                    ? "border-red-200 bg-red-50 text-red-900"
                                    : "border-slate-200 bg-slate-50 text-slate-700"
                        }`}
                        role="status"
                    >
                        <p>{banner.message}</p>
                        {banner.dependencies?.length ? (
                            <ul className="mt-1 list-disc pl-5">
                                {banner.dependencies.map((d) => (
                                    <li key={d}>{d}</li>
                                ))}
                            </ul>
                        ) : null}
                    </div>
                ) : null}

                <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
                    <section className="rounded-lg border border-slate-200 bg-white">
                        <h2 className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">
                            Results
                        </h2>
                        <ul className="max-h-[28rem] overflow-y-auto text-sm">
                            {hits.length === 0 ? (
                                <li className="px-3 py-4 text-slate-500">No results yet.</li>
                            ) : (
                                hits.map((hit) => (
                                    <li key={hit.feature_key}>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedKey(hit.feature_key)}
                                            className={`block w-full px-3 py-2 text-left hover:bg-slate-50 ${
                                                selectedKey === hit.feature_key
                                                    ? "bg-slate-100"
                                                    : ""
                                            }`}
                                        >
                                            <div className="font-medium text-slate-900">
                                                {hit.feature_key}
                                            </div>
                                            <div className="text-xs text-slate-600">
                                                {lifecycleStateLabel(hit.lifecycle_state)}
                                                {hit.name ? ` · ${hit.name}` : ""}
                                            </div>
                                        </button>
                                    </li>
                                ))
                            )}
                        </ul>
                    </section>

                    <section className="space-y-4">
                        {!detail ? (
                            <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-sm text-slate-500">
                                {loadingDetail
                                    ? "Loading feature…"
                                    : "Select a feature to view lifecycle state and actions."}
                            </div>
                        ) : (
                            <>
                                <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
                                    <dl className="grid gap-2 sm:grid-cols-2">
                                        <div>
                                            <dt className="text-xs uppercase text-slate-500">
                                                feature_key
                                            </dt>
                                            <dd className="font-medium text-slate-900">
                                                {detail.feature_key}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-xs uppercase text-slate-500">
                                                Lifecycle
                                            </dt>
                                            <dd className="font-medium text-slate-900">
                                                {lifecycleStateLabel(detail.lifecycle_state)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-xs uppercase text-slate-500">
                                                Name / class
                                            </dt>
                                            <dd className="text-slate-800">
                                                {detail.name_en || detail.name || "—"}
                                                {detail.class_code
                                                    ? ` · ${detail.class_code}`
                                                    : ""}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-xs uppercase text-slate-500">
                                                Source identity
                                            </dt>
                                            <dd className="text-slate-800">
                                                {detail.source_identity}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-xs uppercase text-slate-500">
                                                Local layers
                                            </dt>
                                            <dd className="text-slate-800">
                                                {[
                                                    detail.local_layers.base ? "Base" : null,
                                                    detail.local_layers.core ? "Core" : null,
                                                    detail.local_layers.archive ? "Archive" : null,
                                                    detail.local_layers.suppressed
                                                        ? "Suppressed"
                                                        : null,
                                                ]
                                                    .filter(Boolean)
                                                    .join(", ") || "—"}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-xs uppercase text-slate-500">
                                                Core id
                                            </dt>
                                            <dd className="text-slate-800">
                                                {detail.core_id ?? "—"}
                                            </dd>
                                        </div>
                                    </dl>

                                    <div className="mt-4 flex flex-wrap gap-2">
                                        {visibleActions.includes("promote") ? (
                                            <button
                                                type="button"
                                                disabled={busyAction !== null}
                                                onClick={() => void runAction("promote")}
                                                className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
                                            >
                                                {busyAction === "promote"
                                                    ? "Promoting…"
                                                    : "Promote to Core"}
                                            </button>
                                        ) : null}
                                        {visibleActions.includes("demote") ? (
                                            <button
                                                type="button"
                                                disabled={busyAction !== null}
                                                onClick={() => void runAction("demote")}
                                                className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-60"
                                            >
                                                {busyAction === "demote"
                                                    ? "Demoting…"
                                                    : "Demote to Local"}
                                            </button>
                                        ) : null}
                                        {visibleActions.includes("delete") ? (
                                            <button
                                                type="button"
                                                disabled={busyAction !== null}
                                                onClick={() => setDeleteOpen(true)}
                                                className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60"
                                            >
                                                Delete
                                            </button>
                                        ) : null}
                                        {visibleActions.includes("clear_suppression") ? (
                                            <button
                                                type="button"
                                                disabled={busyAction !== null}
                                                onClick={() => void runAction("clear_suppression")}
                                                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                                            >
                                                {busyAction === "clear_suppression"
                                                    ? "Clearing…"
                                                    : "Clear suppression"}
                                            </button>
                                        ) : null}
                                        {visibleActions.length === 0 ? (
                                            <p className="text-slate-500">
                                                No lifecycle actions for this state.
                                            </p>
                                        ) : null}
                                    </div>
                                </div>

                                <div>
                                    <div className="mb-2 flex items-center gap-2">
                                        <span className="text-sm font-medium text-slate-800">
                                            Selected geometry
                                        </span>
                                        <span
                                            className={`rounded border px-2 py-0.5 text-xs font-medium ${geometrySourceBadgeClass(
                                                detail.geometry_source
                                            )}`}
                                        >
                                            {detail.geometry_source
                                                ? lifecycleStateLabel(detail.geometry_source)
                                                : "None"}
                                        </span>
                                    </div>
                                    <CoreReviewMapPreview
                                        geometry={detail.geometry}
                                        geometryKind="polygon"
                                        entityType={entity === "buildings" ? "building" : "land_area"}
                                        externalId={detail.feature_key}
                                        title="Local feature preview"
                                        emptyHint="No renderable geometry for this lifecycle state."
                                        size="drawer"
                                    />
                                </div>
                            </>
                        )}
                    </section>
                </div>
            </div>

            <CoreReviewConfirmDialog
                open={deleteOpen}
                title="Delete feature from map?"
                description="Delete writes a render suppression so Base and Archive do not reappear. This is different from Demote (which keeps Archive). Confirm to continue."
                confirmLabel="Delete and suppress"
                confirmTone="danger"
                isBusy={busyAction === "delete"}
                onCancel={() => setDeleteOpen(false)}
                onConfirm={() => void runAction("delete")}
            />
        </main>
    );
}
