/**
 * Dev Map dynamic overlays — reuse existing Martin sources from PLACE_MAP_STYLE.
 * Does not invent new MVT endpoints or duplicate source IDs.
 *
 * Perf: sources/layers are created only when Places/Transport are enabled and
 * removed when disabled. Source minzoom matches selectable zoom gates.
 */
import type { Map as MaplibreMap } from "maplibre-gl";

import { MAP_PLACES_VECTOR_SOURCE_ID } from "@/src/components/map/placeMapConfig";
import { dashboardMyanmarTextFont } from "@/src/lib/map/dashboardMapFonts";
import { getMapTextFieldExpression } from "@/src/lib/mapLocalizedName";

import type { DevMapEntityType } from "./devMapEntityRegistry";

/** Same MapLibre source ids as dashboard PLACE_MAP_STYLE / Martin. */
export const DEV_MAP_DYNAMIC_SOURCE_IDS = {
    places: MAP_PLACES_VECTOR_SOURCE_ID,
    transportStops: "transport_stops_v",
    transportRoutes: "transport_route_paths_v",
} as const;

export const DEV_MAP_DYNAMIC_LAYER_IDS = {
    placesPoi: "places-poi",
    placeLabels: "place-labels",
    busStops: "bus-stops",
    busRoutes: "bus-routes",
} as const;

/** Match registry minSelectableZoom / useful paint thresholds. */
export const DEV_MAP_DYNAMIC_MIN_ZOOM = {
    places: 12,
    transport_stops: 11,
    transport_routes: 9,
} as const;

const ALL_DYNAMIC_LAYER_IDS: readonly string[] = [
    DEV_MAP_DYNAMIC_LAYER_IDS.busRoutes,
    DEV_MAP_DYNAMIC_LAYER_IDS.placesPoi,
    DEV_MAP_DYNAMIC_LAYER_IDS.busStops,
    DEV_MAP_DYNAMIC_LAYER_IDS.placeLabels,
];

/** Once Martin is known unreachable, skip further addSource storms this session. */
let martinUnavailableReason: string | null = null;

export function getDevMapMartinUnavailableReason(): string | null {
    return martinUnavailableReason;
}

export function resetDevMapMartinAvailabilityForTests(): void {
    martinUnavailableReason = null;
}

function markMartinUnavailable(reason: string): void {
    if (!martinUnavailableReason) {
        martinUnavailableReason = reason;
        if (process.env.NODE_ENV !== "production") {
            console.warn(`[dev-map] Martin overlays disabled: ${reason}`);
        }
    }
}

/** Call from map error handler when Places/Transport tile fetches fail (status 0 / DNS). */
export function noteDevMapMartinFetchFailure(message: string): void {
    const m = message.toLowerCase();
    if (
        m.includes("tiles_places_v") ||
        m.includes("transport_stops_v") ||
        m.includes("transport_route_paths_v") ||
        m.includes("martin-lively-canyon") ||
        (m.includes("failed to fetch") && m.includes("martin"))
    ) {
        markMartinUnavailable(message.slice(0, 200));
    }
}

export function stripDevMapDynamicOverlays(map: MaplibreMap): void {
    removeDevMapDynamicOverlay(map, "places");
    removeDevMapDynamicOverlay(map, "transport_stops");
    removeDevMapDynamicOverlay(map, "transport_routes");
}

function martinBaseUrl(): string {
    const fromEnv = process.env.NEXT_PUBLIC_TILE_SERVER_URL?.trim();
    if (fromEnv) {
        return fromEnv.replace(/\/+$/, "");
    }
    // Prefer local Martin in development when env is unset.
    if (process.env.NODE_ENV !== "production") {
        return "http://127.0.0.1:3002";
    }
    return "https://martin-lively-canyon-4077.fly.dev";
}

function martinTileTemplate(path: string): string {
    return `${martinBaseUrl()}/${path}/{z}/{x}/{y}`;
}

export function isDevMapDynamicLayerId(layerId: string): boolean {
    return (ALL_DYNAMIC_LAYER_IDS as readonly string[]).includes(layerId);
}

export function listDevMapDynamicLayerIdsForEntity(
    entityType: DevMapEntityType,
): readonly string[] {
    if (entityType === "places") {
        return [DEV_MAP_DYNAMIC_LAYER_IDS.placesPoi, DEV_MAP_DYNAMIC_LAYER_IDS.placeLabels];
    }
    if (entityType === "transport_stops") {
        return [DEV_MAP_DYNAMIC_LAYER_IDS.busStops];
    }
    if (entityType === "transport_routes") {
        return [DEV_MAP_DYNAMIC_LAYER_IDS.busRoutes];
    }
    return [];
}

function removeLayerIfPresent(map: MaplibreMap, layerId: string): void {
    if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
    }
}

function removeSourceIfPresent(map: MaplibreMap, sourceId: string): void {
    if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
    }
}

export function removeDevMapDynamicOverlay(
    map: MaplibreMap,
    entityType: "places" | "transport_stops" | "transport_routes",
): void {
    for (const id of listDevMapDynamicLayerIdsForEntity(entityType)) {
        removeLayerIfPresent(map, id);
    }
    if (entityType === "places") {
        removeSourceIfPresent(map, DEV_MAP_DYNAMIC_SOURCE_IDS.places);
    } else if (entityType === "transport_stops") {
        removeSourceIfPresent(map, DEV_MAP_DYNAMIC_SOURCE_IDS.transportStops);
    } else {
        removeSourceIfPresent(map, DEV_MAP_DYNAMIC_SOURCE_IDS.transportRoutes);
    }
}

export function ensureDevMapDynamicOverlay(
    map: MaplibreMap,
    entityType: "places" | "transport_stops" | "transport_routes",
): void {
    if (martinUnavailableReason) {
        return;
    }

    const labelText = getMapTextFieldExpression("my");

    try {
        if (entityType === "transport_routes") {
            if (!map.getSource(DEV_MAP_DYNAMIC_SOURCE_IDS.transportRoutes)) {
                map.addSource(DEV_MAP_DYNAMIC_SOURCE_IDS.transportRoutes, {
                    type: "vector",
                    tiles: [martinTileTemplate("transport_route_paths_v")],
                    minzoom: DEV_MAP_DYNAMIC_MIN_ZOOM.transport_routes,
                    maxzoom: 22,
                });
            }
            if (!map.getLayer(DEV_MAP_DYNAMIC_LAYER_IDS.busRoutes)) {
                map.addLayer({
                    id: DEV_MAP_DYNAMIC_LAYER_IDS.busRoutes,
                    type: "line",
                    source: DEV_MAP_DYNAMIC_SOURCE_IDS.transportRoutes,
                    "source-layer": "transport_route_paths_v",
                    minzoom: DEV_MAP_DYNAMIC_MIN_ZOOM.transport_routes,
                    layout: {
                        "line-cap": "round",
                        "line-join": "round",
                        visibility: "visible",
                    },
                    paint: {
                        "line-color": "#d97706",
                        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.2, 14, 2.6, 18, 5],
                        "line-opacity": 0.65,
                    },
                });
            }
            return;
        }

        if (entityType === "transport_stops") {
            if (!map.getSource(DEV_MAP_DYNAMIC_SOURCE_IDS.transportStops)) {
                map.addSource(DEV_MAP_DYNAMIC_SOURCE_IDS.transportStops, {
                    type: "vector",
                    tiles: [martinTileTemplate("transport_stops_v")],
                    minzoom: DEV_MAP_DYNAMIC_MIN_ZOOM.transport_stops,
                    maxzoom: 22,
                });
            }
            if (!map.getLayer(DEV_MAP_DYNAMIC_LAYER_IDS.busStops)) {
                map.addLayer({
                    id: DEV_MAP_DYNAMIC_LAYER_IDS.busStops,
                    type: "circle",
                    source: DEV_MAP_DYNAMIC_SOURCE_IDS.transportStops,
                    "source-layer": "transport_stops_v",
                    minzoom: DEV_MAP_DYNAMIC_MIN_ZOOM.transport_stops,
                    layout: { visibility: "visible" },
                    paint: {
                        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 17, 4.5, 20, 7],
                        "circle-color": "#f2a900",
                        "circle-opacity": 0.95,
                        "circle-stroke-color": "#ffffff",
                        "circle-stroke-width": 1.4,
                    },
                });
            }
            return;
        }

        // places
        if (!map.getSource(DEV_MAP_DYNAMIC_SOURCE_IDS.places)) {
            map.addSource(DEV_MAP_DYNAMIC_SOURCE_IDS.places, {
                type: "vector",
                tiles: [`${martinTileTemplate("tiles_places_v")}?v=0`],
                minzoom: DEV_MAP_DYNAMIC_MIN_ZOOM.places,
                maxzoom: 22,
            });
        }
        if (!map.getLayer(DEV_MAP_DYNAMIC_LAYER_IDS.placesPoi)) {
            map.addLayer({
                id: DEV_MAP_DYNAMIC_LAYER_IDS.placesPoi,
                type: "circle",
                source: DEV_MAP_DYNAMIC_SOURCE_IDS.places,
                "source-layer": MAP_PLACES_VECTOR_SOURCE_ID,
                minzoom: DEV_MAP_DYNAMIC_MIN_ZOOM.places,
                layout: { visibility: "visible" },
                paint: {
                    "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2.5, 17, 4.5, 20, 7],
                    "circle-color": "#3aa76d",
                    "circle-opacity": 0.85,
                    "circle-stroke-color": "#ffffff",
                    "circle-stroke-width": 1.2,
                },
            });
        }
        if (!map.getLayer(DEV_MAP_DYNAMIC_LAYER_IDS.placeLabels)) {
            map.addLayer({
                id: DEV_MAP_DYNAMIC_LAYER_IDS.placeLabels,
                type: "symbol",
                source: DEV_MAP_DYNAMIC_SOURCE_IDS.places,
                "source-layer": MAP_PLACES_VECTOR_SOURCE_ID,
                minzoom: 14,
                layout: {
                    visibility: "visible",
                    "text-field": labelText as never,
                    "text-font": dashboardMyanmarTextFont(),
                    "text-size": ["interpolate", ["linear"], ["zoom"], 14, 11, 17, 13, 20, 16],
                    "text-offset": [0, 1],
                    "text-anchor": "top",
                    "text-padding": 4,
                    "text-optional": true,
                },
                paint: {
                    "text-color": "#374151",
                    "text-halo-color": "#ffffff",
                    "text-halo-width": 1.5,
                },
            });
        }
    } catch (error) {
        markMartinUnavailable(
            error instanceof Error ? error.message : "failed to add Martin vector source",
        );
        removeDevMapDynamicOverlay(map, entityType);
    }
}

/** Add all dynamic overlays (used only when callers explicitly want every source). */
export function ensureDevMapDynamicOverlays(map: MaplibreMap): void {
    ensureDevMapDynamicOverlay(map, "transport_routes");
    ensureDevMapDynamicOverlay(map, "places");
    ensureDevMapDynamicOverlay(map, "transport_stops");
}

function moveOverlayLayersToTop(map: MaplibreMap): void {
    for (const id of ALL_DYNAMIC_LAYER_IDS) {
        if (map.getLayer(id)) {
            try {
                map.moveLayer(id);
            } catch {
                // Layer may be mid-add.
            }
        }
    }
}

/**
 * Sync dynamic overlays with the filter: create when enabled, remove when disabled.
 * Does not reload the basemap style.
 */
export function applyDevMapDynamicOverlayVisibility(
    map: MaplibreMap,
    enabled: ReadonlySet<DevMapEntityType>,
): void {
    const entities = ["places", "transport_stops", "transport_routes"] as const;
    for (const entity of entities) {
        if (enabled.has(entity)) {
            try {
                ensureDevMapDynamicOverlay(map, entity);
                for (const id of listDevMapDynamicLayerIdsForEntity(entity)) {
                    if (!map.getLayer(id)) continue;
                    map.setLayoutProperty(id, "visibility", "visible");
                }
            } catch (error) {
                if (process.env.NODE_ENV !== "production") {
                    console.warn(`[dev-map] failed to enable ${entity} overlay:`, error);
                }
            }
        } else {
            removeDevMapDynamicOverlay(map, entity);
        }
    }
    moveOverlayLayersToTop(map);
}
