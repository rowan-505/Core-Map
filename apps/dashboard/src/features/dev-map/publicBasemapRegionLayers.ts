/**
 * Regional layer clones from the **public** production style (`base-map.json`).
 * Used by Dev Map so regional detail matches the web map — not dashboard-map.json.
 */
import type { LayerSpecification, Map as MaplibreMap, StyleSpecification } from "maplibre-gl";
import BaseMapStyle from "@local-map/map-style/base-map.json";
import { BASEMAP_VECTOR_SOURCE_ID } from "@local-map/map-style/basemapSource";

import { remapDashboardSymbolLayerFonts } from "@/src/lib/map/dashboardMapFonts";

export type PublicRegionLayerMap = Pick<MaplibreMap, "getLayer" | "addLayer" | "removeLayer">;

const BASE_STYLE = BaseMapStyle as unknown as StyleSpecification;

function cloneLayer(layer: LayerSpecification): LayerSpecification {
    return typeof structuredClone === "function"
        ? structuredClone(layer)
        : (JSON.parse(JSON.stringify(layer)) as LayerSpecification);
}

export function publicRegionLayerId(baseLayerId: string, regionId: string): string {
    return `${baseLayerId}-${regionId}`;
}

function getPublicRegionalTemplateLayers(): LayerSpecification[] {
    const layers = (BASE_STYLE.layers ?? []) as LayerSpecification[];
    return layers.filter(
        (layer) =>
            layer.id !== "background" &&
            "source" in layer &&
            (layer as { source?: string }).source === BASEMAP_VECTOR_SOURCE_ID,
    );
}

export function buildPublicRegionLayers(regionId: string, sourceId: string): LayerSpecification[] {
    const cloned = getPublicRegionalTemplateLayers().map((layer) => {
        const copy = cloneLayer(layer);
        return {
            ...copy,
            id: publicRegionLayerId(copy.id, regionId),
            source: sourceId,
        } as LayerSpecification;
    });
    // Dashboard serves Myanmar glyphs locally; fontstack remap only — paint/layout stay public.
    return remapDashboardSymbolLayerFonts(cloned);
}

export function publicRegionLayerIds(regionId: string): string[] {
    return getPublicRegionalTemplateLayers().map((layer) => publicRegionLayerId(layer.id, regionId));
}

export function addPublicRegionLayers(
    map: PublicRegionLayerMap,
    regionId: string,
    sourceId: string,
    beforeId?: string,
): void {
    for (const layer of buildPublicRegionLayers(regionId, sourceId)) {
        if (map.getLayer(layer.id)) continue;
        map.addLayer(layer, beforeId && map.getLayer(beforeId) ? beforeId : undefined);
    }
}

export function removePublicRegionLayers(map: PublicRegionLayerMap, regionId: string): void {
    for (const id of publicRegionLayerIds(regionId)) {
        if (map.getLayer(id)) {
            map.removeLayer(id);
        }
    }
}

/** Marker used in tests: Dev Map regional layers come from public base-map.json. */
export const DEV_MAP_PUBLIC_BASEMAP_STYLE_ID = "base-map.json" as const;
