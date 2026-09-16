"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Map as MaplibreMap } from "maplibre-gl";

import CoreReviewConfirmDialog from "@/src/features/core-review/lifecycle/CoreReviewConfirmDialog";
import type { LocalBasemapAction } from "@/src/features/local-basemap/localBasemapActions";

import { DEV_MAP_INSPECTOR_TEST_ID } from "./devMapChromeIds";
import {
    DEV_MAP_DELETE_CONFIRM,
    bannerFromLifecycleResult,
    runDevMapLifecycleAction,
} from "./devMapInspectorLifecycle";
import type {
    DevMapInspectorActionBanner,
    DevMapInspectorDetail,
    DevMapInspectorLifecycleAction,
    DevMapInspectorLoadErrorCode,
    DevMapInspectorLoadState,
} from "./devMapInspectorTypes";
import { refreshDevMapLifecycleOverlay } from "./devMapLifecycleOverlay";
import type { DevMapSelection } from "./devMapSelection";

function lifecycleBadgeClass(state: string | null): string {
    const normalized = (state ?? "").toLowerCase();
    if (normalized === "core") return "bg-emerald-100 text-emerald-800";
    if (normalized === "base" || normalized === "local") return "bg-cyan-100 text-cyan-800";
    if (normalized === "archive") return "bg-orange-100 text-orange-800";
    if (normalized === "deleted") return "bg-rose-100 text-rose-800";
    return "bg-slate-100 text-slate-700";
}

function errorTitle(code: DevMapInspectorLoadErrorCode): string {
    switch (code) {
        case "not_found":
            return "Not found in database";
        case "unsupported":
            return "Details not supported";
        case "missing_id":
            return "Missing identity";
        default:
            return "Failed to load details";
    }
}

function lifecycleButtonClass(tone: DevMapInspectorLifecycleAction["tone"]): string {
    switch (tone) {
        case "promote":
            return "bg-emerald-700 text-white hover:bg-emerald-800";
        case "demote":
            return "border border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100";
        case "delete":
            return "bg-red-700 text-white hover:bg-red-800";
        default:
            return "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50";
    }
}

function busyLabel(action: LocalBasemapAction): string {
    switch (action) {
        case "promote":
            return "Promoting…";
        case "demote":
            return "Demoting…";
        case "delete":
            return "Deleting…";
        case "clear_suppression":
            return "Clearing…";
    }
}

export type DevMapInspectorCardProps = {
    selection: DevMapSelection | null;
    loadState: DevMapInspectorLoadState;
    onClear: () => void;
    /** Called after a lifecycle action so the parent can reload detail. */
    onRefreshDetail: () => void;
    /** Map instance for live overlay invalidation (optional until map ready). */
    map: MaplibreMap | null;
};

/** Shared floating right-side inspector shell with navigation + lifecycle actions. */
export function DevMapInspectorCard({
    selection,
    loadState,
    onClear,
    onRefreshDetail,
    map,
}: DevMapInspectorCardProps) {
    const [busyAction, setBusyAction] = useState<LocalBasemapAction | null>(null);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [banner, setBanner] = useState<DevMapInspectorActionBanner | null>(null);

    useEffect(() => {
        setBanner(null);
        setDeleteOpen(false);
        setBusyAction(null);
    }, [selection?.entityId, selection?.featureKey, selection?.entityType]);

    if (!selection) {
        return (
            <aside
                data-testid={DEV_MAP_INSPECTOR_TEST_ID}
                data-dev-map-inspector="hidden"
                aria-hidden="true"
                className="pointer-events-none invisible absolute right-3 top-16 z-10 w-80 max-w-[min(20rem,calc(100%-1.5rem))]"
            />
        );
    }

    const detail: DevMapInspectorDetail | null =
        loadState.status === "ready" && loadState.selection.entityId === selection.entityId
            ? loadState.detail
            : null;

    const error =
        loadState.status === "error" && loadState.selection.entityId === selection.entityId
            ? loadState
            : null;

    const loading =
        loadState.status === "loading" && loadState.selection.entityId === selection.entityId;

    const badgeLabel = detail?.badgeLabel ?? selection.entityType;
    const displayName = detail?.displayName ?? selection.displayName;

    async function runLifecycle(action: LocalBasemapAction) {
        if (!detail?.lifecycleEntity || !detail.featureKey) {
            return;
        }
        setBusyAction(action);
        setBanner(null);
        try {
            const result = await runDevMapLifecycleAction({
                entity: detail.lifecycleEntity,
                action,
                featureKey: detail.featureKey,
            });
            setBanner(bannerFromLifecycleResult(result));
            if (map) {
                refreshDevMapLifecycleOverlay(map, detail.lifecycleEntity);
            }
            onRefreshDetail();
        } catch (err) {
            setBanner({
                tone: "error",
                message: err instanceof Error ? err.message : "Action failed.",
            });
            onRefreshDetail();
        } finally {
            setBusyAction(null);
            setDeleteOpen(false);
        }
    }

    const linkActions = detail?.actions.filter((a) => a.kind === "link") ?? [];
    const lifecycleActions = detail?.actions.filter((a) => a.kind === "lifecycle") ?? [];

    return (
        <>
            <aside
                data-testid={DEV_MAP_INSPECTOR_TEST_ID}
                data-dev-map-inspector="visible"
                data-entity-type={selection.entityType}
                className="pointer-events-auto absolute right-3 top-16 z-10 flex max-h-[calc(100vh-5rem)] w-80 max-w-[min(20rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-md border border-slate-200 bg-white/95 shadow-sm backdrop-blur-sm"
            >
                <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                                {badgeLabel}
                            </span>
                            {detail?.lifecycleState ? (
                                <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${lifecycleBadgeClass(detail.lifecycleState)}`}
                                    data-lifecycle-state={detail.lifecycleState}
                                >
                                    {detail.lifecycleState}
                                </span>
                            ) : null}
                        </div>
                        <h2
                            className="mt-1 truncate text-sm font-semibold text-slate-900"
                            title={displayName}
                        >
                            {displayName}
                        </h2>
                    </div>
                    <button
                        type="button"
                        className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                        onClick={onClear}
                        data-testid="dev-map-inspector-close"
                    >
                        Close
                    </button>
                </div>

                <div className="overflow-y-auto px-3 py-2.5">
                    {banner ? (
                        <div
                            className={`mb-2 rounded border px-2 py-1.5 text-[11px] ${
                                banner.tone === "success"
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                    : banner.tone === "warning"
                                      ? "border-amber-200 bg-amber-50 text-amber-950"
                                      : banner.tone === "error"
                                        ? "border-red-200 bg-red-50 text-red-900"
                                        : "border-slate-200 bg-slate-50 text-slate-700"
                            }`}
                            role="status"
                            data-inspector-banner={banner.tone}
                        >
                            <p>{banner.message}</p>
                            {banner.dependencies?.length ? (
                                <ul className="mt-1 list-disc pl-4">
                                    {banner.dependencies.map((dep) => (
                                        <li key={dep}>{dep}</li>
                                    ))}
                                </ul>
                            ) : null}
                        </div>
                    ) : null}

                    {loading ? (
                        <p className="text-xs text-slate-500" data-inspector-status="loading">
                            Loading details…
                        </p>
                    ) : null}

                    {error ? (
                        <div
                            className="rounded border border-rose-200 bg-rose-50 px-2 py-2 text-xs text-rose-900"
                            data-inspector-status="error"
                            data-error-code={error.code}
                        >
                            <p className="font-semibold">{errorTitle(error.code)}</p>
                            <p className="mt-1 text-rose-800">{error.message}</p>
                            <dl className="mt-2 space-y-1 text-[11px] text-rose-900/80">
                                <div className="flex justify-between gap-2">
                                    <dt>Entity id</dt>
                                    <dd className="truncate font-mono">{selection.entityId}</dd>
                                </div>
                                {selection.featureKey ? (
                                    <div className="flex justify-between gap-2">
                                        <dt>Feature key</dt>
                                        <dd className="truncate font-mono">{selection.featureKey}</dd>
                                    </div>
                                ) : null}
                            </dl>
                        </div>
                    ) : null}

                    {detail ? (
                        <div data-inspector-status="ready">
                            <dl className="space-y-1.5 text-xs text-slate-700">
                                {detail.stableId ? (
                                    <div className="flex justify-between gap-2">
                                        <dt className="text-slate-500">Stable id</dt>
                                        <dd
                                            className="max-w-[12rem] truncate font-mono"
                                            title={detail.stableId}
                                        >
                                            {detail.stableId}
                                        </dd>
                                    </div>
                                ) : null}
                                {detail.featureKey ? (
                                    <div className="flex justify-between gap-2">
                                        <dt className="text-slate-500">Feature key</dt>
                                        <dd
                                            className="max-w-[12rem] truncate font-mono"
                                            title={detail.featureKey}
                                        >
                                            {detail.featureKey}
                                        </dd>
                                    </div>
                                ) : null}
                                {detail.sourceLabel ? (
                                    <div className="flex justify-between gap-2">
                                        <dt className="text-slate-500">Source</dt>
                                        <dd
                                            className="max-w-[12rem] truncate"
                                            title={detail.sourceLabel}
                                        >
                                            {detail.sourceLabel}
                                        </dd>
                                    </div>
                                ) : null}
                                {detail.fields.map((item) => (
                                    <div key={item.label} className="flex justify-between gap-2">
                                        <dt className="text-slate-500">{item.label}</dt>
                                        <dd
                                            className="max-w-[12rem] truncate text-right"
                                            title={item.value}
                                        >
                                            {item.value}
                                        </dd>
                                    </div>
                                ))}
                            </dl>

                            {detail.fallbackNote ? (
                                <p className="mt-2 text-[11px] text-slate-500">{detail.fallbackNote}</p>
                            ) : null}
                        </div>
                    ) : null}

                    {!loading && !error && !detail ? (
                        <p className="text-xs text-slate-500">Waiting for details…</p>
                    ) : null}
                </div>

                {detail && (linkActions.length > 0 || lifecycleActions.length > 0) ? (
                    <div className="mt-auto space-y-1.5 border-t border-slate-100 px-3 py-2.5">
                        {lifecycleActions.map((action) => (
                            <button
                                key={action.id}
                                type="button"
                                disabled={busyAction !== null}
                                data-inspector-action={action.id}
                                data-action-kind="lifecycle"
                                className={`block w-full rounded px-2 py-1.5 text-center text-xs font-medium disabled:opacity-60 ${lifecycleButtonClass(action.tone)}`}
                                onClick={() => {
                                    if (action.requiresConfirm) {
                                        setDeleteOpen(true);
                                        return;
                                    }
                                    void runLifecycle(action.id);
                                }}
                            >
                                {busyAction === action.id ? busyLabel(action.id) : action.label}
                            </button>
                        ))}
                        {linkActions.map((action) => (
                            <Link
                                key={action.id}
                                href={action.href}
                                prefetch={false}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-xs font-medium text-sky-800 hover:bg-slate-100"
                                data-inspector-action={action.id}
                                data-action-kind="link"
                            >
                                {action.label}
                            </Link>
                        ))}
                    </div>
                ) : null}
            </aside>

            <CoreReviewConfirmDialog
                open={deleteOpen}
                title={DEV_MAP_DELETE_CONFIRM.title}
                description={DEV_MAP_DELETE_CONFIRM.description}
                confirmLabel={DEV_MAP_DELETE_CONFIRM.confirmLabel}
                confirmTone="danger"
                isBusy={busyAction === "delete"}
                onCancel={() => setDeleteOpen(false)}
                onConfirm={() => void runLifecycle("delete")}
            />
        </>
    );
}
