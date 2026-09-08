"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

import { createPreviewBaseMap } from "@/src/components/map/createPreviewBaseMap";
import { MAP_PREVIEW_VIEWPORT_FORM } from "@/src/components/map/mapPreviewUi";
import { PLACE_MAP_DEFAULT_CENTER } from "@/src/components/map/placeMapConfig";
import { useClientMounted } from "@/src/hooks/useClientMounted";

import { accuracyCircleCoordinates, type EvidenceMapPoint } from "./fieldEvidenceView";

type ReportLocationCompareMapProps = {
    points: EvidenceMapPoint[];
    distanceM: number | null;
    labels?: Partial<Record<EvidenceMapPoint["role"], string>>;
    showDistanceWhen?: "canonical" | "gps-to-proposed";
};

const COLORS: Record<EvidenceMapPoint["role"], string> = {
    canonical: "#2563eb",
    observed: "#ea580c",
    proposed: "#16a34a",
};

const DEFAULT_LABELS: Record<EvidenceMapPoint["role"], string> = {
    canonical: "Current canonical stop",
    observed: "Observed surveyor location",
    proposed: "Proposed corrected location",
};

const ACCURACY_SOURCE = "report-evidence-accuracy";
const ACCURACY_FILL = "report-evidence-accuracy-fill";
const ACCURACY_LINE = "report-evidence-accuracy-line";

function formatDistance(distanceM: number | null): string {
    if (distanceM === null || !Number.isFinite(distanceM)) {
        return "Distance unavailable";
    }
    if (distanceM < 10) {
        return `${distanceM.toFixed(1)} m apart`;
    }
    return `${Math.round(distanceM)} m apart`;
}

function makeMarker(color: string, label: string) {
    const el = document.createElement("div");
    el.title = label;
    el.style.width = "16px";
    el.style.height = "16px";
    el.style.borderRadius = "9999px";
    el.style.background = color;
    el.style.border = "2px solid #fff";
    el.style.boxShadow = "0 0 0 1px rgb(0 0 0 / 0.25)";
    return new maplibregl.Marker({ element: el, anchor: "center" });
}

export default function ReportLocationCompareMap({
    points,
    distanceM,
    labels,
    showDistanceWhen = "canonical",
}: ReportLocationCompareMapProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markersRef = useRef<maplibregl.Marker[]>([]);
    const [mapReady, setMapReady] = useState(false);
    const clientMounted = useClientMounted();

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
        const map = mapRef.current;
        if (!map || !mapReady) {
            return;
        }

        for (const marker of markersRef.current) {
            marker.remove();
        }
        markersRef.current = [];

        for (const point of points) {
            const marker = makeMarker(COLORS[point.role], labels?.[point.role] ?? DEFAULT_LABELS[point.role])
                .setLngLat([point.longitude, point.latitude])
                .addTo(map);
            markersRef.current.push(marker);
        }

        const observed = points.find((point) => point.role === "observed" && (point.accuracyM ?? 0) > 0);
        const circle =
            observed && observed.accuracyM
                ? accuracyCircleCoordinates(observed.longitude, observed.latitude, observed.accuracyM)
                : null;
        const geojson: GeoJSON.Feature<GeoJSON.Polygon> | GeoJSON.FeatureCollection = circle
            ? {
                  type: "Feature",
                  properties: {},
                  geometry: { type: "Polygon", coordinates: [circle] },
              }
            : { type: "FeatureCollection", features: [] };

        if (map.getSource(ACCURACY_SOURCE)) {
            (map.getSource(ACCURACY_SOURCE) as maplibregl.GeoJSONSource).setData(geojson);
        } else {
            map.addSource(ACCURACY_SOURCE, { type: "geojson", data: geojson });
            map.addLayer({
                id: ACCURACY_FILL,
                type: "fill",
                source: ACCURACY_SOURCE,
                paint: { "fill-color": COLORS.observed, "fill-opacity": 0.18 },
            });
            map.addLayer({
                id: ACCURACY_LINE,
                type: "line",
                source: ACCURACY_SOURCE,
                paint: { "line-color": COLORS.observed, "line-width": 1.5, "line-opacity": 0.7 },
            });
        }

        if (points.length === 0) {
            map.jumpTo({ center: PLACE_MAP_DEFAULT_CENTER, zoom: 12 });
            return;
        }
        if (points.length === 1) {
            const only = points[0]!;
            map.easeTo({ center: [only.longitude, only.latitude], zoom: 17, duration: 400 });
            return;
        }

        const bounds = new maplibregl.LngLatBounds();
        for (const point of points) {
            bounds.extend([point.longitude, point.latitude]);
        }
        map.fitBounds(bounds, { padding: 56, maxZoom: 18, duration: 400 });
    }, [mapReady, points, labels]);

    if (points.length === 0) {
        return <p className="text-sm text-gray-500">No coordinates to compare.</p>;
    }

    const roles = new Set(points.map((point) => point.role));
    const showDistance =
        showDistanceWhen === "gps-to-proposed"
            ? roles.has("observed") && roles.has("proposed")
            : roles.has("canonical") && (roles.has("observed") || roles.has("proposed"));

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
                <div className="flex flex-wrap gap-3">
                    {(["canonical", "observed", "proposed"] as const).map((role) =>
                        roles.has(role) ? (
                            <span key={role} className="inline-flex items-center gap-1.5">
                                <span
                                    className="inline-block h-2.5 w-2.5 rounded-full"
                                    style={{ backgroundColor: COLORS[role] }}
                                />
                                {labels?.[role] ?? DEFAULT_LABELS[role]}
                            </span>
                        ) : null
                    )}
                </div>
                {showDistance ? (
                    <span className="font-medium text-gray-800">{formatDistance(distanceM)}</span>
                ) : null}
            </div>
            <div ref={containerRef} className={MAP_PREVIEW_VIEWPORT_FORM} />
        </div>
    );
}
