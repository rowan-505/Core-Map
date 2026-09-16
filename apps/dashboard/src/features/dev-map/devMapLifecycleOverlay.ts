/**
 * Dev Map LIVE lifecycle overlays — MVT from local-basemap API (tile_source.*_v).
 * Leaves PMTiles basemap paint unchanged. Never talks to Postgres from the browser.
 *
 * Perf: sources are lazy-created when Buildings/Land are enabled and removed when
 * disabled so MapLibre does not keep fetching lifecycle tiles for hidden layers.
 */
import type { Map as MaplibreMap, RequestTransformFunction } from "maplibre-gl";

import { getDashboardAccessToken } from "@/src/lib/api";
import { dashboardComplexTextTransformRequest } from "@/src/lib/map/dashboardMaplibreComplexText";

import type { DevMapEntityType } from "./devMapEntityRegistry";

export type DevMapLifecycleOverlayEntity = "buildings" | "land";

export const DEV_MAP_LIFECYCLE_SOURCE_IDS = {
    buildings: "dev-map-lifecycle-buildings",
    land: "dev-map-lifecycle-land",
} as const;

export const DEV_MAP_LIFECYCLE_SOURCE_LAYERS = {
    buildings: "buildings_lifecycle",
    land: "land_lifecycle",
} as const;

export const DEV_MAP_LIFECYCLE_LAYER_IDS = {
    buildingsFill: "dev-map-lifecycle-buildings-fill",
    buildingsOutline: "dev-map-lifecycle-buildings-outline",
    landFill: "dev-map-lifecycle-land-fill",
    landOutline: "dev-map-lifecycle-land-outline",
} as const;

/** Must beat static PMTiles buildings(10) / land(40). */
export const DEV_MAP_LIFECYCLE_SELECTION_PRIORITY = {
    buildings: 5,
    land: 8,
} as const;

/**
 * Client source/layer minzoom — matches API outer gates.
 * Lifecycle MVT is Core+Archive only (Base stays on PMTiles).
 * Sources are also removed when zoomed out so tiles stop fetching.
 */
export const DEV_MAP_LIFECYCLE_MIN_ZOOM = {
    buildings: 15,
    land: 14,
} as const;

export const DEV_MAP_LIFECYCLE_COLORS = {
    base: "#00E5FF",
    core: "#00E676",
    archive: "#FF9100",
    selectedOutline: "#111111",
} as const;

const ALL_LIFECYCLE_LAYER_IDS: readonly string[] = [
    DEV_MAP_LIFECYCLE_LAYER_IDS.buildingsFill,
    DEV_MAP_LIFECYCLE_LAYER_IDS.buildingsOutline,
    DEV_MAP_LIFECYCLE_LAYER_IDS.landFill,
    DEV_MAP_LIFECYCLE_LAYER_IDS.landOutline,
];

const versionBySource = new WeakMap<MaplibreMap, { buildings: number; land: number }>();

function getApiBaseUrl(): string {
    const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
    if (!raw) {
        throw new Error("NEXT_PUBLIC_API_BASE_URL is required for Dev Map lifecycle overlays.");
    }
    return raw.replace(/\/+$/, "");
}

export function buildDevMapLifecycleTileUrlTemplate(
    entity: DevMapLifecycleOverlayEntity,
    version = 0,
): string {
    const layer =
        entity === "buildings"
            ? DEV_MAP_LIFECYCLE_SOURCE_LAYERS.buildings
            : DEV_MAP_LIFECYCLE_SOURCE_LAYERS.land;
    const base = getApiBaseUrl();
    const v = version > 0 ? `?v=${version}` : "";
    return `${base}/local-basemap/tiles/${layer}/{z}/{x}/{y}${v}`;
}

function lifecycleColorMatchExpression(): unknown[] {
    return [
        "match",
        ["get", "resolved_source"],
        "base",
        DEV_MAP_LIFECYCLE_COLORS.base,
        "core",
        DEV_MAP_LIFECYCLE_COLORS.core,
        "archive",
        DEV_MAP_LIFECYCLE_COLORS.archive,
        /* fallback */ "#9E9E9E",
    ];
}

function ensureVersionState(map: MaplibreMap): { buildings: number; land: number } {
    let state = versionBySource.get(map);
    if (!state) {
        state = { buildings: 0, land: 0 };
        versionBySource.set(map, state);
    }
    return state;
}

/**
 * Auth + glyph transform for Dev Map. Lifecycle MVT requires Bearer from accessToken.
 * Call {@link ensureDashboardAccessToken} before enabling overlays so the token is fresh
 * (transformRequest is synchronous and cannot refresh mid-request).
 */
export function createDevMapTransformRequest(): RequestTransformFunction {
    return (url, resourceType) => {
        const glyph = dashboardComplexTextTransformRequest(url, resourceType);
        if (glyph) return glyph;

        if (url.includes("/local-basemap/tiles/")) {
            if (typeof window === "undefined") return { url };
            const token = getDashboardAccessToken();
            if (!token) return { url };
            return {
                url,
                headers: { Authorization: `Bearer ${token}` },
            };
        }
        return undefined;
    };
}

export function isDevMapLifecycleLayerId(layerId: string): boolean {
    return (ALL_LIFECYCLE_LAYER_IDS as readonly string[]).includes(layerId);
}

export function lifecycleEntityForLayerId(layerId: string): DevMapLifecycleOverlayEntity | null {
    if (
        layerId === DEV_MAP_LIFECYCLE_LAYER_IDS.buildingsFill ||
        layerId === DEV_MAP_LIFECYCLE_LAYER_IDS.buildingsOutline
    ) {
        return "buildings";
    }
    if (
        layerId === DEV_MAP_LIFECYCLE_LAYER_IDS.landFill ||
        layerId === DEV_MAP_LIFECYCLE_LAYER_IDS.landOutline
    ) {
        return "land";
    }
    return null;
}

export function listDevMapLifecycleLayerIdsForEntity(
    entityType: DevMapEntityType,
): readonly string[] {
    if (entityType === "buildings") {
        return [
            DEV_MAP_LIFECYCLE_LAYER_IDS.buildingsFill,
            DEV_MAP_LIFECYCLE_LAYER_IDS.buildingsOutline,
        ];
    }
    if (entityType === "land") {
        return [DEV_MAP_LIFECYCLE_LAYER_IDS.landFill, DEV_MAP_LIFECYCLE_LAYER_IDS.landOutline];
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

/** Remove one lifecycle overlay (layers then source) so tiles stop fetching. */
export function removeDevMapLifecycleOverlay(
    map: MaplibreMap,
    entity: DevMapLifecycleOverlayEntity,
): void {
    for (const id of listDevMapLifecycleLayerIdsForEntity(entity)) {
        removeLayerIfPresent(map, id);
    }
    removeSourceIfPresent(map, DEV_MAP_LIFECYCLE_SOURCE_IDS[entity]);
}

/**
 * Add vector source + fill/outline for one entity. Idempotent.
 */
export function ensureDevMapLifecycleOverlay(
    map: MaplibreMap,
    entity: DevMapLifecycleOverlayEntity,
): void {
    const versions = ensureVersionState(map);
    const sourceId = DEV_MAP_LIFECYCLE_SOURCE_IDS[entity];
    const sourceLayer = DEV_MAP_LIFECYCLE_SOURCE_LAYERS[entity];
    const minzoom = DEV_MAP_LIFECYCLE_MIN_ZOOM[entity];
    const color = lifecycleColorMatchExpression();

    if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
            type: "vector",
            tiles: [buildDevMapLifecycleTileUrlTemplate(entity, versions[entity])],
            minzoom,
            maxzoom: 20,
        });
    }

    if (entity === "land") {
        if (!map.getLayer(DEV_MAP_LIFECYCLE_LAYER_IDS.landFill)) {
            map.addLayer({
                id: DEV_MAP_LIFECYCLE_LAYER_IDS.landFill,
                type: "fill",
                source: sourceId,
                "source-layer": sourceLayer,
                minzoom,
                paint: {
                    "fill-color": color as never,
                    "fill-opacity": 0.18,
                },
            });
        }
        if (!map.getLayer(DEV_MAP_LIFECYCLE_LAYER_IDS.landOutline)) {
            map.addLayer({
                id: DEV_MAP_LIFECYCLE_LAYER_IDS.landOutline,
                type: "line",
                source: sourceId,
                "source-layer": sourceLayer,
                minzoom,
                paint: {
                    "line-color": color as never,
                    "line-width": 2.25,
                    "line-opacity": 0.95,
                },
            });
        }
        return;
    }

    if (!map.getLayer(DEV_MAP_LIFECYCLE_LAYER_IDS.buildingsFill)) {
        map.addLayer({
            id: DEV_MAP_LIFECYCLE_LAYER_IDS.buildingsFill,
            type: "fill",
            source: sourceId,
            "source-layer": sourceLayer,
            minzoom,
            paint: {
                "fill-color": color as never,
                "fill-opacity": 0.38,
            },
        });
    }
    if (!map.getLayer(DEV_MAP_LIFECYCLE_LAYER_IDS.buildingsOutline)) {
        map.addLayer({
            id: DEV_MAP_LIFECYCLE_LAYER_IDS.buildingsOutline,
            type: "line",
            source: sourceId,
            "source-layer": sourceLayer,
            minzoom,
            paint: {
                "line-color": color as never,
                "line-width": 1.35,
                "line-opacity": 0.95,
            },
        });
    }
}

/** @deprecated Prefer ensureDevMapLifecycleOverlay per entity; kept for call-site clarity. */
export function ensureDevMapLifecycleOverlays(map: MaplibreMap): void {
    ensureDevMapLifecycleOverlay(map, "land");
    ensureDevMapLifecycleOverlay(map, "buildings");
}

/**
 * Sync lifecycle overlays with the filter + current zoom.
 * Create only when enabled AND zoomed in; remove when disabled or zoomed out
 * so MapLibre cancels pending tile fetches and frees browser connections for detail.
 */
export function applyDevMapLifecycleOverlayVisibility(
    map: MaplibreMap,
    enabled: ReadonlySet<DevMapEntityType>,
): void {
    const zoom = typeof map.getZoom === "function" ? map.getZoom() : 0;
    const entities: DevMapLifecycleOverlayEntity[] = ["buildings", "land"];
    for (const entity of entities) {
        const zoomOk = zoom >= DEV_MAP_LIFECYCLE_MIN_ZOOM[entity];
        if (enabled.has(entity) && zoomOk) {
            ensureDevMapLifecycleOverlay(map, entity);
            for (const id of listDevMapLifecycleLayerIdsForEntity(entity)) {
                if (!map.getLayer(id)) continue;
                map.setLayoutProperty(id, "visibility", "visible");
            }
        } else {
            removeDevMapLifecycleOverlay(map, entity);
        }
    }
}

let lifecycleAuthRetryInFlight: Promise<void> | null = null;

/**
 * After a 401 on lifecycle tiles: refresh JWT once, then reload overlay tile URLs.
 * Debounced so a tile storm triggers a single refresh+retry.
 */
export function recoverDevMapLifecycleAuth(map: MaplibreMap): void {
    if (lifecycleAuthRetryInFlight) return;
    lifecycleAuthRetryInFlight = (async () => {
        try {
            const { ensureDashboardAccessToken } = await import("@/src/lib/api");
            const token = await ensureDashboardAccessToken();
            if (!token) return;
            refreshDevMapLifecycleOverlay(map, "all");
        } catch {
            /* ignore */
        } finally {
            lifecycleAuthRetryInFlight = null;
        }
    })();
}

/**
 * Invalidate and reload lifecycle vector tiles without camera change or full page reload.
 * No-op when the overlay source was removed (entity filter off).
 */
export function refreshDevMapLifecycleOverlay(
    map: MaplibreMap,
    entity: DevMapLifecycleOverlayEntity | "all" = "all",
): void {
    const versions = ensureVersionState(map);
    const targets: DevMapLifecycleOverlayEntity[] =
        entity === "all" ? ["buildings", "land"] : [entity];

    for (const target of targets) {
        versions[target] += 1;
        const sourceId = DEV_MAP_LIFECYCLE_SOURCE_IDS[target];
        const source = map.getSource(sourceId);
        if (!source || !("setTiles" in source) || typeof source.setTiles !== "function") {
            continue;
        }
        source.setTiles([buildDevMapLifecycleTileUrlTemplate(target, versions[target])]);
    }
}
