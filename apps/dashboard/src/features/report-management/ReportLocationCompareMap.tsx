"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

import { createPreviewBaseMap } from "@/src/components/map/createPreviewBaseMap";
import { MAP_PREVIEW_VIEWPORT_FORM } from "@/src/components/map/mapPreviewUi";
import { PLACE_MAP_DEFAULT_CENTER } from "@/src/components/map/placeMapConfig";
import { useClientMounted } from "@/src/hooks/useClientMounted";

import {
    EVIDENCE_MAP_MAX_AUTO_ZOOM,
    SURVEY_OUTSIDE_MAP_MESSAGE,
    evidenceMapFitPoints,
    formatEvidenceDistanceMeters,
    type EvidenceMapMarker,
    type EvidenceMapMarkerRole,
    type EvidenceMapModel,
} from "./evidenceMapModel";

type ReportLocationCompareMapProps = {
    model: EvidenceMapModel;
};

const COLORS: Record<EvidenceMapMarkerRole, string> = {
    canonical: "#2563eb",
    proposed: "#16a34a",
    observed: "#ea580c",
    removal: "#dc2626",
    previous: "#6b7280",
    next: "#6b7280",
    surrounding: "#9ca3af",
    target: "#2563eb",
};

const LINE_SOURCE = "report-evidence-lines";
const LINE_BEFORE = "report-evidence-line-before";
const LINE_AFTER = "report-evidence-line-after";
const LINE_INSERT = "report-evidence-line-insert";

const LEGEND: Array<{ role: EvidenceMapMarkerRole; label: string }> = [
    { role: "canonical", label: "Current" },
    { role: "proposed", label: "Proposed" },
    { role: "observed", label: "Survey GPS" },
    { role: "removal", label: "Remove" },
    { role: "surrounding", label: "Route stops" },
];

function makePlainMarker(marker: EvidenceMapMarker) {
    const el = document.createElement("div");
    el.title = marker.label;
    el.setAttribute("aria-label", marker.label);
    const numbered =
        marker.role === "surrounding" ||
        marker.role === "previous" ||
        marker.role === "next" ||
        marker.role === "removal";
    if (numbered && marker.sequence != null) {
        el.textContent = String(marker.sequence);
        el.style.minWidth = "20px";
        el.style.height = "20px";
        el.style.padding = "0 4px";
        el.style.borderRadius = "9999px";
        el.style.background = COLORS[marker.role];
        el.style.color = "#fff";
        el.style.fontSize = "10px";
        el.style.fontWeight = "600";
        el.style.display = "flex";
        el.style.alignItems = "center";
        el.style.justifyContent = "center";
        el.style.border = "2px solid #fff";
        el.style.boxShadow = "0 0 0 1px rgb(0 0 0 / 0.2)";
    } else {
        el.style.width = "14px";
        el.style.height = "14px";
        el.style.borderRadius = "9999px";
        el.style.background = COLORS[marker.role];
        el.style.border = "2px solid #fff";
        el.style.boxShadow = "0 0 0 1px rgb(0 0 0 / 0.25)";
    }
    return new maplibregl.Marker({ element: el, anchor: "center" });
}

function fitModel(
    map: maplibregl.Map,
    model: EvidenceMapModel,
    includeObservedOutlier: boolean
) {
    const points = evidenceMapFitPoints(model, includeObservedOutlier);
    if (points.length === 0) {
        map.jumpTo({ center: PLACE_MAP_DEFAULT_CENTER, zoom: 12 });
        return;
    }
    if (points.length === 1) {
        const only = points[0]!;
        map.easeTo({
            center: [only.longitude, only.latitude],
            zoom: Math.min(17, EVIDENCE_MAP_MAX_AUTO_ZOOM),
            duration: 350,
        });
        return;
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const point of points) {
        bounds.extend([point.longitude, point.latitude]);
    }
    map.fitBounds(bounds, {
        padding: 56,
        maxZoom: EVIDENCE_MAP_MAX_AUTO_ZOOM,
        duration: 350,
    });
}

export default function ReportLocationCompareMap({ model }: ReportLocationCompareMapProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markersRef = useRef<maplibregl.Marker[]>([]);
    const [mapReady, setMapReady] = useState(false);
    const [showSurveyLocation, setShowSurveyLocation] = useState(false);
    const clientMounted = useClientMounted();

    const legendRoles = useMemo(() => new Set(model.markers.map((marker) => marker.role)), [model.markers]);

    useEffect(() => {
        if (!clientMounted || !containerRef.current || mapRef.current) {
            return;
        }

        let cancelled = false;
        const root = containerRef.current;

        void (async () => {
            let map: maplibregl.Map;
            try {
                map = await createPreviewBaseMap(root, {
                    zoom: 16,
                    onLoad: () => setMapReady(true),
                });
            } catch (err) {
                console.error("ReportLocationCompareMap init failed:", err);
                return;
            }

            if (cancelled) {
                map.remove();
                return;
            }

            mapRef.current = map;
        })();

        return () => {
            cancelled = true;
            for (const marker of markersRef.current) {
                marker.remove();
            }
            markersRef.current = [];
            mapRef.current?.remove();
            mapRef.current = null;
        };
    }, [clientMounted]);

    useEffect(() => {
        const root = containerRef.current;
        const map = mapRef.current;
        if (!root || !map || !mapReady) {
            return;
        }
        const ro = new ResizeObserver(() => {
            map.resize();
        });
        ro.observe(root);
        return () => ro.disconnect();
    }, [mapReady]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) {
            return;
        }

        for (const marker of markersRef.current) {
            marker.remove();
        }
        markersRef.current = [];

        for (const marker of model.markers) {
            const mapMarker = makePlainMarker(marker)
                .setLngLat([marker.longitude, marker.latitude])
                .addTo(map);
            markersRef.current.push(mapMarker);
        }

        const features: GeoJSON.Feature[] = model.lines.map((line) => ({
            type: "Feature",
            properties: { kind: line.kind },
            geometry: { type: "LineString", coordinates: line.coordinates },
        }));
        const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

        if (map.getSource(LINE_SOURCE)) {
            (map.getSource(LINE_SOURCE) as maplibregl.GeoJSONSource).setData(geojson);
        } else {
            map.addSource(LINE_SOURCE, { type: "geojson", data: geojson });
            map.addLayer({
                id: LINE_BEFORE,
                type: "line",
                source: LINE_SOURCE,
                filter: ["==", ["get", "kind"], "before"],
                paint: { "line-color": "#6b7280", "line-width": 3, "line-opacity": 0.85 },
            });
            map.addLayer({
                id: LINE_AFTER,
                type: "line",
                source: LINE_SOURCE,
                filter: ["==", ["get", "kind"], "after"],
                paint: {
                    "line-color": "#16a34a",
                    "line-width": 3,
                    "line-opacity": 0.9,
                    "line-dasharray": [1.4, 1.4],
                },
            });
            map.addLayer({
                id: LINE_INSERT,
                type: "line",
                source: LINE_SOURCE,
                filter: ["==", ["get", "kind"], "insert"],
                paint: { "line-color": "#16a34a", "line-width": 3, "line-opacity": 0.9 },
            });
        }

        fitModel(map, model, showSurveyLocation);
    }, [mapReady, model, showSurveyLocation]);

    if (model.empty) {
        return <p className="text-sm text-gray-500">No coordinates to compare.</p>;
    }

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
                <div className="flex flex-wrap gap-3">
                    {LEGEND.map((item) =>
                        legendRoles.has(item.role) ||
                        (item.role === "surrounding" &&
                            (legendRoles.has("previous") || legendRoles.has("next"))) ? (
                            <span key={item.role} className="inline-flex items-center gap-1.5">
                                <span
                                    className="inline-block h-2.5 w-2.5 rounded-full"
                                    style={{ backgroundColor: COLORS[item.role] }}
                                />
                                {item.label}
                            </span>
                        ) : null
                    )}
                </div>
                {model.distance ? (
                    <span className="font-medium text-gray-800">
                        {model.distance.label}: {formatEvidenceDistanceMeters(model.distance.meters)}
                    </span>
                ) : null}
            </div>

            {model.observedIsOutlier && !showSurveyLocation ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-950">
                    <span>{SURVEY_OUTSIDE_MAP_MESSAGE}</span>
                    <button
                        type="button"
                        className="rounded-md border border-amber-300 bg-white px-2 py-1 font-medium text-amber-950 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                        onClick={() => setShowSurveyLocation(true)}
                    >
                        Show survey location
                    </button>
                </div>
            ) : null}

            <div ref={containerRef} className={MAP_PREVIEW_VIEWPORT_FORM} />
        </div>
    );
}
