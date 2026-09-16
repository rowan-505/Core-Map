"use client";

import { memo } from "react";

import {
    DEV_MAP_CONTROL_BADGE_TEST_ID,
    DEV_MAP_CONTROL_BAR_TEST_ID,
    DEV_MAP_ENTITY_FILTER_TEST_ID,
} from "./devMapChromeIds";
import type { DevMapEntityType, DevMapFilterPreset } from "./devMapEntityRegistry";
import { DEV_MAP_ENTITY_REGISTRY } from "./devMapEntityRegistry";
import { DevMapInspectorCard } from "./DevMapInspector";
import { DevMapSearchControl } from "./DevMapSearchControl";
import type { DevMapSearchHit } from "./devMapSearch";
import type { DevMapSelection } from "./devMapSelection";
import { useDevMapInspectorDetail } from "./useDevMapInspectorDetail";

export {
    DEV_MAP_CONTROL_BADGE_TEST_ID,
    DEV_MAP_CONTROL_BAR_TEST_ID,
    DEV_MAP_ENTITY_FILTER_TEST_ID,
    DEV_MAP_INSPECTOR_TEST_ID,
    DEV_MAP_SEARCH_TEST_ID,
} from "./devMapChromeIds";

const PRESETS: { id: DevMapFilterPreset; label: string; title: string }[] = [
    {
        id: "all",
        label: "All",
        title: "All PMTiles layers (Buildings, Land, Streets, Admin, Water). Places/Transport: use checkboxes.",
    },
    {
        id: "core",
        label: "Core Data",
        title: "Buildings, land, streets, admin, water (PMTiles)",
    },
    {
        id: "transport",
        label: "Transport",
        title: "Transport stops + routes (needs Martin). Zooms in if needed.",
    },
    {
        id: "clear",
        label: "Reset",
        title: "Restore default layers (fixes empty map after hiding everything)",
    },
];

export type DevMapControlBarProps = {
    mapReady: boolean;
    mapError: string | null;
    enabledEntities: ReadonlySet<DevMapEntityType>;
    onToggleEntity: (entityType: DevMapEntityType, checked: boolean) => void;
    onPreset: (preset: DevMapFilterPreset) => void;
    onSearchSelect: (hit: DevMapSearchHit) => void | Promise<void>;
};

/** Top bar: DEV MAP badge + compact search + entity checkboxes + trivial presets. */
function DevMapControlBarImpl({
    mapReady,
    mapError,
    enabledEntities,
    onToggleEntity,
    onPreset,
    onSearchSelect,
}: DevMapControlBarProps) {
    return (
        <div
            data-testid={DEV_MAP_CONTROL_BAR_TEST_ID}
            className="pointer-events-auto flex max-w-[min(72rem,calc(100vw-1.5rem))] flex-col gap-2 rounded-md border border-slate-200/90 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm"
        >
            <div className="flex flex-wrap items-center gap-3">
                <span
                    data-testid={DEV_MAP_CONTROL_BADGE_TEST_ID}
                    className="rounded bg-amber-500 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white"
                >
                    DEV MAP
                </span>
                <span className="text-sm font-medium text-slate-800">Internal map</span>
                <DevMapSearchControl disabled={!mapReady} onSelectHit={onSearchSelect} />
                <span className="ml-auto text-xs text-slate-500">
                    {mapError ? (
                        <span className="text-red-600">{mapError}</span>
                    ) : mapReady ? (
                        "Map ready"
                    ) : (
                        "Loading basemap…"
                    )}
                </span>
            </div>
            {mapReady ? (
                <p className="text-[11px] leading-4 text-slate-500">
                    Reset restores default layers. Places / Transport need a working Martin URL (
                    <code className="text-[10px]">NEXT_PUBLIC_TILE_SERVER_URL</code>
                    ). All = PMTiles only.
                </p>
            ) : null}

            <div
                data-testid={DEV_MAP_ENTITY_FILTER_TEST_ID}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2"
            >
                {DEV_MAP_ENTITY_REGISTRY.map((entry) => {
                    const checked = entry.supported && enabledEntities.has(entry.entityType);
                    return (
                        <label
                            key={entry.entityType}
                            className={`inline-flex items-center gap-1.5 text-xs ${
                                entry.supported
                                    ? "cursor-pointer text-slate-700"
                                    : "cursor-not-allowed text-slate-400"
                            }`}
                            title={
                                entry.supported
                                    ? entry.label
                                    : (entry.unsupportedReason ?? "Not available on this map")
                            }
                        >
                            <input
                                type="checkbox"
                                className="size-3.5 rounded border-slate-300"
                                checked={checked}
                                disabled={!entry.supported || !mapReady}
                                data-entity-type={entry.entityType}
                                data-supported={entry.supported ? "true" : "false"}
                                onChange={(event) => {
                                    onToggleEntity(entry.entityType, event.target.checked);
                                }}
                            />
                            <span>
                                {entry.label}
                                {!entry.supported ? (
                                    <span className="ml-0.5 text-[10px] uppercase tracking-wide">
                                        n/a
                                    </span>
                                ) : null}
                            </span>
                        </label>
                    );
                })}

                <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:inline-block" aria-hidden />

                <div className="flex flex-wrap items-center gap-1">
                    {PRESETS.map((preset) => (
                        <button
                            key={preset.id}
                            type="button"
                            disabled={!mapReady}
                            data-preset={preset.id}
                            title={preset.title}
                            className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                            onClick={() => onPreset(preset.id)}
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

export const DevMapControlBar = memo(DevMapControlBarImpl);

export type DevMapInspectorProps = {
    selected: DevMapSelection | null;
    onClear: () => void;
    map: import("maplibre-gl").Map | null;
};

/**
 * Right-side floating inspector — shared shell + entity adapters for detail fetch.
 * Lifecycle Promote/Demote/Delete reuse local-basemap API helpers (no new semantics).
 */
export function DevMapInspector({ selected, onClear, map }: DevMapInspectorProps) {
    const { loadState, refreshDetail } = useDevMapInspectorDetail(selected);
    return (
        <DevMapInspectorCard
            selection={selected}
            loadState={loadState}
            onClear={onClear}
            onRefreshDetail={refreshDetail}
            map={map}
        />
    );
}
