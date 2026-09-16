import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import { GeoJSONSource, type Map as MaplibreMap } from "maplibre-gl";

import type { DevMapSelection } from "./devMapSelection";

export const DEV_MAP_SELECTION_SOURCE_ID = "dev-map-selection-highlight" as const;
export const DEV_MAP_SELECTION_FILL_LAYER_ID = "dev-map-selection-fill" as const;
export const DEV_MAP_SELECTION_LINE_LAYER_ID = "dev-map-selection-line" as const;
export const DEV_MAP_SELECTION_CIRCLE_LAYER_ID = "dev-map-selection-circle" as const;

export const DEV_MAP_SELECTION_LAYER_IDS = [
    DEV_MAP_SELECTION_FILL_LAYER_ID,
    DEV_MAP_SELECTION_LINE_LAYER_ID,
    DEV_MAP_SELECTION_CIRCLE_LAYER_ID,
] as const;

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };
/** Strong contrasting outline for selected feature (lifecycle + static). */
const HIGHLIGHT_COLOR = "#f59e0b";
const HIGHLIGHT_OUTLINE = "#111111";

function emptyCollection(): FeatureCollection {
    return { type: "FeatureCollection", features: [] };
}

/** Idempotent highlight layers above the basemap (does not edit base style paint). */
export function ensureDevMapSelectionHighlight(map: MaplibreMap): boolean {
    if (!map.isStyleLoaded()) {
        return false;
    }

    if (!map.getSource(DEV_MAP_SELECTION_SOURCE_ID)) {
        map.addSource(DEV_MAP_SELECTION_SOURCE_ID, { type: "geojson", data: EMPTY_FC });
    }

    if (!map.getLayer(DEV_MAP_SELECTION_FILL_LAYER_ID)) {
        map.addLayer({
            id: DEV_MAP_SELECTION_FILL_LAYER_ID,
            type: "fill",
            source: DEV_MAP_SELECTION_SOURCE_ID,
            filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
            paint: {
                "fill-color": HIGHLIGHT_COLOR,
                "fill-opacity": 0.28,
            },
        });
    }

    if (!map.getLayer(DEV_MAP_SELECTION_LINE_LAYER_ID)) {
        map.addLayer({
            id: DEV_MAP_SELECTION_LINE_LAYER_ID,
            type: "line",
            source: DEV_MAP_SELECTION_SOURCE_ID,
            filter: [
                "any",
                ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
                ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
            ],
            paint: {
                "line-color": HIGHLIGHT_OUTLINE,
                "line-width": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    8,
                    2.5,
                    14,
                    4,
                    18,
                    6,
                ],
                "line-opacity": 1,
            },
        });
    }

    if (!map.getLayer(DEV_MAP_SELECTION_CIRCLE_LAYER_ID)) {
        map.addLayer({
            id: DEV_MAP_SELECTION_CIRCLE_LAYER_ID,
            type: "circle",
            source: DEV_MAP_SELECTION_SOURCE_ID,
            filter: ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false],
            paint: {
                "circle-radius": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    8,
                    5,
                    14,
                    8,
                    18,
                    11,
                ],
                "circle-color": HIGHLIGHT_COLOR,
                "circle-stroke-color": "#92400e",
                "circle-stroke-width": 2,
                "circle-opacity": 0.95,
            },
        });
    }

    for (const id of DEV_MAP_SELECTION_LAYER_IDS) {
        if (map.getLayer(id)) {
            map.moveLayer(id);
        }
    }

    return true;
}

export function setDevMapSelectionHighlight(
    map: MaplibreMap,
    selection: DevMapSelection | null,
): void {
    if (!ensureDevMapSelectionHighlight(map)) {
        return;
    }

    const source = map.getSource(DEV_MAP_SELECTION_SOURCE_ID);
    if (!(source instanceof GeoJSONSource)) {
        return;
    }

    if (!selection) {
        source.setData(emptyCollection());
        return;
    }

    const fc: FeatureCollection<Geometry, GeoJsonProperties> = {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                geometry: selection.geometry,
                properties: {
                    entityType: selection.entityType,
                    entityId: selection.entityId,
                },
            },
        ],
    };
    source.setData(fc);

    for (const id of DEV_MAP_SELECTION_LAYER_IDS) {
        if (map.getLayer(id)) {
            map.moveLayer(id);
        }
    }
}

export function clearDevMapSelectionHighlight(map: MaplibreMap): void {
    setDevMapSelectionHighlight(map, null);
}
