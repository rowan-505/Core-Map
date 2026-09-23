"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { createPreviewBaseMap } from "@/src/components/map/createPreviewBaseMap";
import { ensureDashboardAccessToken } from "@/src/lib/api";
import { dashboardComplexTextTransformRequest } from "@/src/lib/map/dashboardMaplibreComplexText";

import {
    adminGeographyTileAuthHeaders,
    buildAdminGeographyTileUrlTemplate,
    isAdminGeographyTileUrl,
} from "./api";
import type { AdminGeographyTileFilters } from "./types";
import {
    ADMIN_GEO_COLORS,
    ADMIN_GEO_FILL_LAYER,
    ADMIN_GEO_LINE_LAYER,
    ADMIN_GEO_SELECTED_FILL,
    ADMIN_GEO_SELECTED_LINE,
    ADMIN_GEO_SELECTED_SOURCE,
    ADMIN_GEO_SOURCE_ID,
    adminGeographyFillLayer,
    adminGeographyLineLayer,
} from "./mapStyles";

export type AdminGeographyMapProps = {
    tileFilters: AdminGeographyTileFilters | null;
    selectedId: string | null;
    selectedBbox: [number, number, number, number] | null;
    selectedGeometry: unknown | null;
    onSelectFeatureId: (id: string) => void;
    onMapReady?: (map: MaplibreMap | null) => void;
    /** When true, skip fitBounds (editing in progress). */
    suppressFitBounds?: boolean;
};

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
    return { type: "FeatureCollection", features: [] };
}

/** Accept Geometry, Feature, or FeatureCollection (first feature) from the detail API. */
function toMapGeometry(raw: unknown): GeoJSON.Geometry | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const type = obj.type;
    if (type === "Feature") {
        const geom = obj.geometry;
        return geom && typeof geom === "object" ? (geom as GeoJSON.Geometry) : null;
    }
    if (type === "FeatureCollection") {
        const features = obj.features;
        if (!Array.isArray(features) || features.length === 0) return null;
        const first = features[0] as Record<string, unknown> | undefined;
        const geom = first?.geometry;
        return geom && typeof geom === "object" ? (geom as GeoJSON.Geometry) : null;
    }
    if (
        type === "Polygon" ||
        type === "MultiPolygon" ||
        type === "Point" ||
        type === "MultiPoint" ||
        type === "LineString" ||
        type === "MultiLineString" ||
        type === "GeometryCollection"
    ) {
        return raw as GeoJSON.Geometry;
    }
    return null;
}

function raiseSelectedLayers(map: MaplibreMap) {
    if (map.getLayer(ADMIN_GEO_SELECTED_FILL)) {
        map.moveLayer(ADMIN_GEO_SELECTED_FILL);
    }
    if (map.getLayer(ADMIN_GEO_SELECTED_LINE)) {
        map.moveLayer(ADMIN_GEO_SELECTED_LINE);
    }
}

function ensureSelectedLayers(map: MaplibreMap) {
    if (!map.getSource(ADMIN_GEO_SELECTED_SOURCE)) {
        map.addSource(ADMIN_GEO_SELECTED_SOURCE, {
            type: "geojson",
            data: emptyFeatureCollection(),
        });
    }
    if (!map.getLayer(ADMIN_GEO_SELECTED_FILL)) {
        map.addLayer({
            id: ADMIN_GEO_SELECTED_FILL,
            type: "fill",
            source: ADMIN_GEO_SELECTED_SOURCE,
            paint: {
                "fill-color": ADMIN_GEO_COLORS.selected,
                "fill-opacity": 0.35,
            },
        });
    }
    if (!map.getLayer(ADMIN_GEO_SELECTED_LINE)) {
        map.addLayer({
            id: ADMIN_GEO_SELECTED_LINE,
            type: "line",
            source: ADMIN_GEO_SELECTED_SOURCE,
            paint: {
                "line-color": ADMIN_GEO_COLORS.selected,
                "line-width": 3,
                "line-opacity": 1,
            },
        });
    }
    raiseSelectedLayers(map);
}

function syncMvtSource(map: MaplibreMap, filters: AdminGeographyTileFilters | null) {
    if (map.getLayer(ADMIN_GEO_FILL_LAYER)) map.removeLayer(ADMIN_GEO_FILL_LAYER);
    if (map.getLayer(ADMIN_GEO_LINE_LAYER)) map.removeLayer(ADMIN_GEO_LINE_LAYER);
    if (map.getSource(ADMIN_GEO_SOURCE_ID)) map.removeSource(ADMIN_GEO_SOURCE_ID);

    if (!filters) {
        return;
    }

    const tiles = [buildAdminGeographyTileUrlTemplate(filters)];
    map.addSource(ADMIN_GEO_SOURCE_ID, {
        type: "vector",
        tiles,
        minzoom: 5,
        maxzoom: 14,
    });
    map.addLayer(adminGeographyFillLayer());
    map.addLayer(adminGeographyLineLayer());
    raiseSelectedLayers(map);
}

export default function AdminGeographyMap({
    tileFilters,
    selectedId,
    selectedBbox,
    selectedGeometry,
    onSelectFeatureId,
    onMapReady,
    suppressFitBounds = false,
}: AdminGeographyMapProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<MaplibreMap | null>(null);
    const onSelectRef = useRef(onSelectFeatureId);
    onSelectRef.current = onSelectFeatureId;
    const onMapReadyRef = useRef(onMapReady);
    onMapReadyRef.current = onMapReady;

    // Keep latest selection in refs so we can apply after async map load.
    const selectedIdRef = useRef(selectedId);
    const selectedBboxRef = useRef(selectedBbox);
    const selectedGeometryRef = useRef(selectedGeometry);
    const suppressFitBoundsRef = useRef(suppressFitBounds);
    selectedIdRef.current = selectedId;
    selectedBboxRef.current = selectedBbox;
    selectedGeometryRef.current = selectedGeometry;
    suppressFitBoundsRef.current = suppressFitBounds;
    const tileFiltersRef = useRef(tileFilters);
    tileFiltersRef.current = tileFilters;

    const applySelectionToMap = (map: MaplibreMap) => {
        if (!map.isStyleLoaded()) return;
        ensureSelectedLayers(map);
        const source = map.getSource(ADMIN_GEO_SELECTED_SOURCE) as GeoJSONSource | undefined;
        if (!source) return;

        const geometry = toMapGeometry(selectedGeometryRef.current);
        if (geometry) {
            source.setData({
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        properties: { id: selectedIdRef.current },
                        geometry,
                    },
                ],
            });
        } else {
            source.setData(emptyFeatureCollection());
        }

        if (!suppressFitBoundsRef.current) {
            const bbox = selectedBboxRef.current;
            if (bbox && bbox.length === 4) {
                const [minLng, minLat, maxLng, maxLat] = bbox;
                map.fitBounds(
                    [
                        [minLng, minLat],
                        [maxLng, maxLat],
                    ],
                    { padding: 48, maxZoom: 12, duration: 500 },
                );
            }
        }

        raiseSelectedLayers(map);
    };

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        let cancelled = false;
        let map: MaplibreMap | null = null;

        void (async () => {
            await ensureDashboardAccessToken();
            if (cancelled || !containerRef.current) return;

            map = await createPreviewBaseMap(containerRef.current, {
                zoom: 5.5,
                minZoom: 4,
                maxZoom: 18,
                navigationMode: "compact",
                onLoad: (m) => {
                    // Attach Bearer for admin-area MVT (transformRequest is sync).
                    m.setTransformRequest((url, resourceType) => {
                        const glyph = dashboardComplexTextTransformRequest(url, resourceType);
                        if (glyph) return glyph;
                        if (isAdminGeographyTileUrl(url)) {
                            return {
                                url,
                                headers: adminGeographyTileAuthHeaders(),
                            };
                        }
                        return { url };
                    });

                    ensureSelectedLayers(m);
                    syncMvtSource(m, tileFiltersRef.current);
                    applySelectionToMap(m);

                    m.on("click", ADMIN_GEO_FILL_LAYER, (e) => {
                        const id = e.features?.[0]?.properties?.id;
                        if (typeof id === "string" && id.trim()) {
                            onSelectRef.current(id);
                        } else if (typeof id === "number") {
                            onSelectRef.current(String(id));
                        }
                    });
                    m.on("mouseenter", ADMIN_GEO_FILL_LAYER, () => {
                        m.getCanvas().style.cursor = "pointer";
                    });
                    m.on("mouseleave", ADMIN_GEO_FILL_LAYER, () => {
                        m.getCanvas().style.cursor = "";
                    });
                },
            });

            if (cancelled) {
                map.remove();
                return;
            }
            mapRef.current = map;
            onMapReadyRef.current?.(map);
            // Style may already be loaded if "load" fired before we assigned the ref.
            if (map.isStyleLoaded()) {
                applySelectionToMap(map);
            }
        })();

        return () => {
            cancelled = true;
            onMapReadyRef.current?.(null);
            mapRef.current?.remove();
            mapRef.current = null;
        };
        // Mount once; filter / selection updates handled below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const sync = () => {
            void ensureDashboardAccessToken().then(() => {
                if (!mapRef.current) return;
                syncMvtSource(mapRef.current, tileFilters);
                applySelectionToMap(mapRef.current);
            });
        };

        if (map.isStyleLoaded()) {
            sync();
        } else {
            map.once("load", sync);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tileFilters]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const run = () => applySelectionToMap(map);
        if (map.isStyleLoaded()) {
            run();
        } else {
            map.once("load", run);
        }
    }, [selectedId, selectedBbox, selectedGeometry, suppressFitBounds]);

    return <div ref={containerRef} className="h-full w-full bg-slate-200" />;
}
