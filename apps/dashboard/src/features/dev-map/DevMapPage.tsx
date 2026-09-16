"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MaplibreMap, MapMouseEvent } from "maplibre-gl";

import { useClientMounted } from "@/src/hooks/useClientMounted";

import { createDevMapBasemap } from "./createDevMapBasemap";
import { DevMapControlBar, DevMapInspector } from "./DevMapChrome";
import { resolveDevMapClickSelection } from "./devMapClickSelect";
import {
    applyDevMapFilterPreset,
    toggleDevMapEntityEnabled,
} from "./devMapEntityFilterState";
import {
    createDefaultDevMapEnabledEntities,
    getDevMapEntityEntry,
    type DevMapEntityType,
    type DevMapFilterPreset,
} from "./devMapEntityRegistry";
import { applyDevMapEntityVisibility } from "./devMapEntityVisibility";
import {
    flyToDevMapSelection,
    resolveDevMapSearchHitToSelection,
    shouldAutoEnableEntityForSearchHit,
    type DevMapSearchHit,
} from "./devMapSearch";
import type { DevMapSelection } from "./devMapSelection";
import {
    clearDevMapSelectionHighlight,
    ensureDevMapSelectionHighlight,
    setDevMapSelectionHighlight,
} from "./devMapSelectionHighlight";
import { isDevMapUiEnabled } from "./isDevMapUiEnabled";

/**
 * Full-content Dev Map: public PMTiles basemap + entity filter + click select
 * + LIVE lifecycle MVT overlays for Buildings / Land (local-basemap API tiles).
 */
export default function DevMapPage() {
    const enabled = isDevMapUiEnabled();
    const mounted = useClientMounted();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<MaplibreMap | null>(null);
    const [mapInstance, setMapInstance] = useState<MaplibreMap | null>(null);
    const enabledEntitiesRef = useRef<ReadonlySet<DevMapEntityType>>(
        createDefaultDevMapEnabledEntities(),
    );
    const [mapReady, setMapReady] = useState(false);
    const [mapError, setMapError] = useState<string | null>(null);
    const [enabledEntities, setEnabledEntities] = useState(() => createDefaultDevMapEnabledEntities());
    const [selection, setSelection] = useState<DevMapSelection | null>(null);
    const searchResolveAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        enabledEntitiesRef.current = enabledEntities;
    }, [enabledEntities]);

    const applySelection = useCallback((next: DevMapSelection | null) => {
        setSelection(next);
        const map = mapRef.current;
        if (!map) return;
        setDevMapSelectionHighlight(map, next);
    }, []);

    const clearSelection = useCallback(() => {
        applySelection(null);
    }, [applySelection]);

    const syncVisibility = useCallback(
        (next: ReadonlySet<DevMapEntityType>) => {
            const map = mapRef.current;
            const apply = () => {
                if (!map) return;
                try {
                    applyDevMapEntityVisibility(map, next);
                } catch (error) {
                    if (process.env.NODE_ENV !== "production") {
                        console.warn("[dev-map] visibility sync failed:", error);
                    }
                }
            };
            void (async () => {
                try {
                    const { ensureDashboardAccessToken } = await import("@/src/lib/api");
                    await ensureDashboardAccessToken();
                } catch {
                    /* ignore */
                }
                apply();
                if (map) {
                    window.requestAnimationFrame(apply);
                    map.once("idle", apply);
                }
            })();
            setSelection((current) => {
                if (current && !next.has(current.entityType)) {
                    if (map) clearDevMapSelectionHighlight(map);
                    return null;
                }
                return current;
            });
        },
        [],
    );

    const onToggleEntity = useCallback(
        (entityType: DevMapEntityType, checked: boolean) => {
            setEnabledEntities((prev) => {
                const next = toggleDevMapEntityEnabled(prev, entityType, checked);
                syncVisibility(next);
                return next;
            });
            const map = mapRef.current;
            if (!checked || !map) return;
            const entry = getDevMapEntityEntry(entityType);
            if (entry.supported && map.getZoom() < entry.minSelectableZoom) {
                map.easeTo({ zoom: entry.minSelectableZoom, duration: 400 });
            }
        },
        [syncVisibility],
    );

    const onPreset = useCallback(
        (preset: DevMapFilterPreset) => {
            const next = applyDevMapFilterPreset(preset);
            setEnabledEntities(next);
            syncVisibility(next);
            const map = mapRef.current;
            if (!map) return;
            // Ensure Places/Transport are visible after Transport preset.
            let minZoom = map.getZoom();
            for (const type of next) {
                const entry = getDevMapEntityEntry(type);
                if (
                    entry.supported &&
                    (type === "places" ||
                        type === "transport_stops" ||
                        type === "transport_routes")
                ) {
                    minZoom = Math.max(minZoom, entry.minSelectableZoom);
                }
            }
            if (minZoom > map.getZoom() + 0.05) {
                map.easeTo({ zoom: minZoom, duration: 450 });
            }
            window.requestAnimationFrame(() => {
                try {
                    map.resize();
                    applyDevMapEntityVisibility(map, next);
                } catch {
                    /* ignore */
                }
            });
        },
        [syncVisibility],
    );

    const onSearchSelect = useCallback(
        async (hit: DevMapSearchHit) => {
            const map = mapRef.current;
            if (!map) {
                throw new Error("Map is not ready.");
            }

            if (shouldAutoEnableEntityForSearchHit(hit.entityType, enabledEntitiesRef.current)) {
                setEnabledEntities((prev) => {
                    const next = toggleDevMapEntityEnabled(prev, hit.entityType, true);
                    syncVisibility(next);
                    return next;
                });
            }

            searchResolveAbortRef.current?.abort();
            const controller = new AbortController();
            searchResolveAbortRef.current = controller;
            try {
                const selection = await resolveDevMapSearchHitToSelection(hit, controller.signal);
                if (controller.signal.aborted) return;
                flyToDevMapSelection(map, selection);
                applySelection(selection);
            } finally {
                if (searchResolveAbortRef.current === controller) {
                    searchResolveAbortRef.current = null;
                }
            }
        },
        [applySelection, syncVisibility],
    );

    useEffect(() => {
        if (!enabled || !mounted) return;
        const container = containerRef.current;
        if (!container) return;

        let cancelled = false;
        setMapReady(false);
        setMapError(null);
        setSelection(null);
        setMapInstance(null);

        const initialEnabled = createDefaultDevMapEnabledEntities();
        setEnabledEntities(initialEnabled);
        enabledEntitiesRef.current = initialEnabled;

        void createDevMapBasemap(container, {
            initialEnabledEntities: initialEnabled,
            onLoad: (map) => {
                if (cancelled) return;
                // Style is ready here — safe to add highlight layers / query layers.
                ensureDevMapSelectionHighlight(map);
                applyDevMapEntityVisibility(map, enabledEntitiesRef.current);

                const onClick = (event: MapMouseEvent) => {
                    const next = resolveDevMapClickSelection(
                        map,
                        event.point,
                        enabledEntitiesRef.current,
                    );
                    applySelection(next);
                };
                map.on("click", onClick);
                map.getCanvas().style.cursor = "default";

                const previousRemove = map.remove.bind(map);
                map.remove = () => {
                    map.off("click", onClick);
                    previousRemove();
                };

                setMapReady(true);
            },
        })
            .then((map) => {
                if (cancelled) {
                    map.remove();
                    return;
                }
                mapRef.current = map;
                setMapInstance(map);
                // Do not mutate style here — MapLibre style is not loaded yet.
                // Visibility + click wiring run in onLoad above.
            })
            .catch((err) => {
                if (cancelled) return;
                setMapError(err instanceof Error ? err.message : "Failed to initialize Dev Map");
            });

        return () => {
            cancelled = true;
            searchResolveAbortRef.current?.abort();
            searchResolveAbortRef.current = null;
            mapRef.current?.remove();
            mapRef.current = null;
            setMapInstance(null);
        };
    }, [enabled, mounted, applySelection]);

    useEffect(() => {
        const map = mapInstance;
        const container = containerRef.current;
        if (!map || !container) return;

        const resize = () => {
            try {
                // Always resize — gating on isStyleLoaded() missed DevTools dock /
                // sidebar size changes and left overlays painted only in part of the canvas.
                map.resize();
            } catch {
                // Style may be mid-update.
            }
        };

        resize();
        const frame = window.requestAnimationFrame(resize);
        const idle = () => {
            resize();
        };
        map.once("idle", idle);
        const observer = new ResizeObserver(() => {
            resize();
            window.requestAnimationFrame(resize);
        });
        observer.observe(container);
        window.addEventListener("resize", resize);

        return () => {
            window.cancelAnimationFrame(frame);
            map.off("idle", idle);
            observer.disconnect();
            window.removeEventListener("resize", resize);
        };
    }, [mapInstance]);

    if (!enabled) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-2xl rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950">
                    <p className="font-semibold">Dev Map is disabled</p>
                    <p className="mt-2 text-amber-900">
                        This internal tool is available only in local non-production builds. Enable{" "}
                        <code className="text-xs">NEXT_PUBLIC_ENABLE_LOCAL_BASEMAP_ADMIN=true</code>{" "}
                        (existing local admin flag) or{" "}
                        <code className="text-xs">NEXT_PUBLIC_ENABLE_DEV_MAP=true</code> on localhost.
                    </p>
                </div>
            </main>
        );
    }

    return (
        <main className="absolute inset-0 overflow-hidden bg-slate-200">
            <div
                ref={containerRef}
                className="absolute inset-0 h-full w-full"
                data-testid="dev-map-canvas"
            />
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-3">
                <div className="pointer-events-auto">
                    <DevMapControlBar
                        mapReady={mapReady}
                        mapError={mapError}
                        enabledEntities={enabledEntities}
                        onToggleEntity={onToggleEntity}
                        onPreset={onPreset}
                        onSearchSelect={onSearchSelect}
                    />
                </div>
            </div>
            <DevMapInspector selected={selection} onClear={clearSelection} map={mapInstance} />
        </main>
    );
}
