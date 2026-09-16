"use client";

/**
 * Dev Map MapLibre factory — public overview + public regional base-map.json layers.
 * Does not use createPreviewBaseMap / dashboard-map.json / dashboard-overview-map.json.
 */
import maplibregl from "maplibre-gl";
import { ensurePmtilesProtocol } from "@local-map/map-style/registerPmtilesProtocol";

import {
    startRegionalPmtilesLoader,
    type RegionalPmtilesLoaderHandle,
} from "@/src/lib/basemaps/regionLoader";
import { attachMapLibreDevDebugMap } from "@/src/lib/mapLibreDebug";
import { attachDashboardMapErrorHandler } from "@/src/components/map/mapErrorHandlers";
import { ensureDashboardMaplibreComplexTextPlugin } from "@/src/lib/map/dashboardMaplibreComplexText";
import { logDashboardGlyphServingHealthInDev } from "@/src/lib/map/dashboardGlyphDevCheck";
import { logDashboardMapFontConfig } from "@/src/lib/map/dashboardMapFonts";

import {
    assertDevMapUsesPublicOverviewStyle,
    fetchDevMapPublicOverviewStyle,
} from "./devMapBasemapStyle";
import {
    DEV_MAP_FALLBACK_CENTER,
    DEV_MAP_FALLBACK_ZOOM,
    DEV_MAP_MAX_ZOOM,
    DEV_MAP_MIN_ZOOM,
    DEV_MAP_OVERVIEW_FIT_BOUNDS,
    DEV_MAP_STARTUP_FIT_PADDING,
} from "./devMapViewport";
import {
    addPublicRegionLayers,
    publicRegionLayerIds,
    removePublicRegionLayers,
} from "./publicBasemapRegionLayers";
import type { DevMapEntityType } from "./devMapEntityRegistry";
import { createDefaultDevMapEnabledEntities } from "./devMapEntityRegistry";
import {
    applyDevMapEntityVisibility,
    reapplyDevMapEntityVisibility,
} from "./devMapEntityVisibility";
import { createDevMapTransformRequest } from "./devMapLifecycleOverlay";
import { ensureDashboardAccessToken } from "@/src/lib/api";

const IS_DEV = process.env.NODE_ENV !== "production";

export type CreateDevMapBasemapOptions = {
    onLoad?: (map: maplibregl.Map) => void;
    /** Initial entity filter; defaults to registry defaultVisible for supported types. */
    initialEnabledEntities?: ReadonlySet<DevMapEntityType>;
};

/**
 * Creates a full-content Dev Map with public CoreMap basemap behavior:
 * PMTiles protocol (once), overview source, viewport regional packages, public styles,
 * camera max zoom 20, Myanmar overview fit on load.
 */
export async function createDevMapBasemap(
    container: HTMLDivElement,
    options?: CreateDevMapBasemapOptions,
): Promise<maplibregl.Map> {
    await ensurePmtilesProtocol(maplibregl);
    await ensureDashboardMaplibreComplexTextPlugin();
    logDashboardGlyphServingHealthInDev();
    logDashboardMapFontConfig("map:dev-map-style-fonts");

    const style = await fetchDevMapPublicOverviewStyle();
    assertDevMapUsesPublicOverviewStyle(style);

    const baseLayerIds = (style.layers ?? []).map((layer) => layer.id);

    const map = new maplibregl.Map({
        container,
        style,
        center: DEV_MAP_FALLBACK_CENTER,
        zoom: DEV_MAP_FALLBACK_ZOOM,
        minZoom: DEV_MAP_MIN_ZOOM,
        maxZoom: DEV_MAP_MAX_ZOOM,
        transformRequest: createDevMapTransformRequest(),
    });

    map.addControl(new maplibregl.NavigationControl(), "bottom-right");
    attachDashboardMapErrorHandler(map, "createDevMapBasemap");

    let loaderHandle: RegionalPmtilesLoaderHandle | null = null;
    let mapRemoved = false;
    const originalRemove = map.remove.bind(map);
    map.remove = () => {
        mapRemoved = true;
        loaderHandle?.destroy();
        originalRemove();
    };

    const initialEnabled =
        options?.initialEnabledEntities ?? createDefaultDevMapEnabledEntities();

    void startRegionalPmtilesLoader(map, {
        baseLayerIds,
        clampRegionalSourceMaxZoom: true,
        layerOps: {
            addRegionLayers: (layerMap, regionId, sourceId, beforeId) => {
                addPublicRegionLayers(layerMap, regionId, sourceId, beforeId);
                // New regional clones must inherit the current filter without style reload.
                reapplyDevMapEntityVisibility(map);
            },
            removeRegionLayers: removePublicRegionLayers,
            regionLayerIds: publicRegionLayerIds,
        },
    })
        .then((handle) => {
            if (mapRemoved) {
                handle.destroy();
                return;
            }
            loaderHandle = handle;
        })
        .catch((err) => {
            if (IS_DEV) console.warn("[dev-map:regions] loader failed to start:", err);
        });

    map.on("load", () => {
        attachMapLibreDevDebugMap(map);
        // Refresh JWT before lifecycle MVT starts (transformRequest is sync).
        void ensureDashboardAccessToken()
            .catch(() => null)
            .finally(() => {
                try {
                    applyDevMapEntityVisibility(map, initialEnabled);
                } catch (err) {
                    if (IS_DEV) console.warn("[dev-map] overlay/visibility init failed:", err);
                }
            });
        // Mount/unmount lifecycle sources as zoom crosses gates (frees API connections).
        map.on("zoomend", () => {
            try {
                reapplyDevMapEntityVisibility(map);
            } catch {
                /* ignore */
            }
        });
        // Container often lays out after Map construction — force a paint size.
        try {
            map.resize();
        } catch (err) {
            if (IS_DEV) console.warn("[dev-map] initial resize failed:", err);
        }
        try {
            map.fitBounds(
                [
                    [...DEV_MAP_OVERVIEW_FIT_BOUNDS[0]],
                    [...DEV_MAP_OVERVIEW_FIT_BOUNDS[1]],
                ],
                {
                    padding: { ...DEV_MAP_STARTUP_FIT_PADDING },
                    duration: 0,
                    maxZoom: 6.5,
                },
            );
        } catch (err) {
            if (IS_DEV) console.warn("[dev-map] overview fitBounds failed:", err);
        }
        try {
            map.resize();
        } catch {
            // ignore
        }
        options?.onLoad?.(map);
    });

    return map;
}
