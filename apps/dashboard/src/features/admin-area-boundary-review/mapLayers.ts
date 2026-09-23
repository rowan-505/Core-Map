import type { GeoJSONSource, Map as MaplibreMap, MapLayerMouseEvent } from "maplibre-gl";
import maplibregl from "maplibre-gl";

import {
    formatAdminAreaBoundaryLabel,
    type AdminAreaBoundaryContext,
    type AdminAreaBoundaryMember,
    type BoundaryReviewToggles,
} from "./types";

export const BR_SELECTED_SOURCE = "aa-br-selected";
export const BR_NEIGHBOURS_SOURCE = "aa-br-neighbours";
export const BR_PARENT_SOURCE = "aa-br-parent";
export const BR_ISSUES_SOURCE = "aa-br-issues";
export const BR_LABELS_SOURCE = "aa-br-labels";

export const BR_SELECTED_FILL = "aa-br-selected-fill";
export const BR_SELECTED_LINE = "aa-br-selected-line";
export const BR_NEIGHBOURS_FILL = "aa-br-neighbours-fill";
export const BR_NEIGHBOURS_LINE = "aa-br-neighbours-line";
export const BR_PARENT_LINE = "aa-br-parent-line";
export const BR_ISSUES_FILL = "aa-br-issues-fill";
export const BR_ISSUES_OUTSIDE_FILL = "aa-br-issues-outside-fill";
export const BR_LABELS_LAYER = "aa-br-labels";

const HATCH_IMAGE_ID = "aa-br-outside-hatch";

function emptyFc(): GeoJSON.FeatureCollection {
    return { type: "FeatureCollection", features: [] };
}

function memberFeature(
    member: AdminAreaBoundaryMember,
    role: string,
): GeoJSON.Feature | null {
    if (!member.geometry) {
        return null;
    }
    return {
        type: "Feature",
        properties: {
            role,
            id: member.id,
            public_id: member.public_id,
            display_name: member.display_name,
            type: member.type,
            geometry_source: member.geometry_source,
            verification_status: member.verification_status,
            label: formatAdminAreaBoundaryLabel({
                displayName: member.display_name,
                type: member.type,
                publicId: member.public_id,
            }),
        },
        geometry: member.geometry,
    };
}

function labelPointFeature(member: AdminAreaBoundaryMember): GeoJSON.Feature | null {
    if (!member.geometry) {
        return null;
    }
    const bbox = member.bbox;
    let coordinates: [number, number] | null = null;
    if (bbox && bbox.length === 4) {
        coordinates = [(bbox[0]! + bbox[2]!) / 2, (bbox[1]! + bbox[3]!) / 2];
    } else if (member.geometry.type === "Point") {
        coordinates = member.geometry.coordinates as [number, number];
    }
    if (!coordinates) {
        return null;
    }
    return {
        type: "Feature",
        properties: {
            public_id: member.public_id,
            label: formatAdminAreaBoundaryLabel({
                displayName: member.display_name,
                type: member.type,
                publicId: member.public_id,
            }),
        },
        geometry: { type: "Point", coordinates },
    };
}

function ensureHatchImage(map: MaplibreMap) {
    if (map.hasImage(HATCH_IMAGE_ID)) {
        return;
    }
    const size = 8;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        return;
    }
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(126, 34, 206, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, size);
    ctx.lineTo(size, 0);
    ctx.stroke();
    ctx.strokeStyle = "rgba(220, 38, 38, 0.55)";
    ctx.beginPath();
    ctx.moveTo(-2, size / 2);
    ctx.lineTo(size / 2, -2);
    ctx.moveTo(size / 2, size + 2);
    ctx.lineTo(size + 2, size / 2);
    ctx.stroke();
    const data = ctx.getImageData(0, 0, size, size);
    map.addImage(HATCH_IMAGE_ID, data, { pixelRatio: 1 });
}

function ensureSource(map: MaplibreMap, id: string) {
    if (!map.getSource(id)) {
        map.addSource(id, { type: "geojson", data: emptyFc() });
    }
}

function ensureLayers(map: MaplibreMap) {
    ensureHatchImage(map);
    ensureSource(map, BR_PARENT_SOURCE);
    ensureSource(map, BR_NEIGHBOURS_SOURCE);
    ensureSource(map, BR_SELECTED_SOURCE);
    ensureSource(map, BR_ISSUES_SOURCE);
    ensureSource(map, BR_LABELS_SOURCE);

    if (!map.getLayer(BR_PARENT_LINE)) {
        map.addLayer({
            id: BR_PARENT_LINE,
            type: "line",
            source: BR_PARENT_SOURCE,
            paint: {
                "line-color": "#7c3aed",
                "line-width": 2.5,
                "line-dasharray": [2, 2],
                "line-opacity": 0.95,
            },
        });
    }
    if (!map.getLayer(BR_NEIGHBOURS_FILL)) {
        map.addLayer({
            id: BR_NEIGHBOURS_FILL,
            type: "fill",
            source: BR_NEIGHBOURS_SOURCE,
            paint: {
                "fill-color": "#94a3b8",
                "fill-opacity": 0.05,
            },
        });
    }
    if (!map.getLayer(BR_NEIGHBOURS_LINE)) {
        map.addLayer({
            id: BR_NEIGHBOURS_LINE,
            type: "line",
            source: BR_NEIGHBOURS_SOURCE,
            paint: {
                "line-color": "#64748b",
                "line-width": 1.5,
                "line-opacity": 0.9,
            },
        });
    }
    if (!map.getLayer(BR_SELECTED_FILL)) {
        map.addLayer({
            id: BR_SELECTED_FILL,
            type: "fill",
            source: BR_SELECTED_SOURCE,
            paint: {
                "fill-color": "#22d3ee",
                "fill-opacity": 0.28,
            },
        });
    }
    if (!map.getLayer(BR_SELECTED_LINE)) {
        map.addLayer({
            id: BR_SELECTED_LINE,
            type: "line",
            source: BR_SELECTED_SOURCE,
            paint: {
                "line-color": "#2563eb",
                "line-width": 3.5,
                "line-opacity": 1,
            },
        });
    }
    if (!map.getLayer(BR_ISSUES_FILL)) {
        map.addLayer({
            id: BR_ISSUES_FILL,
            type: "fill",
            source: BR_ISSUES_SOURCE,
            filter: ["==", ["get", "kind"], "overlap"],
            paint: {
                "fill-color": "#dc2626",
                "fill-opacity": 0.45,
            },
        });
    }
    if (!map.getLayer(BR_ISSUES_OUTSIDE_FILL)) {
        map.addLayer({
            id: BR_ISSUES_OUTSIDE_FILL,
            type: "fill",
            source: BR_ISSUES_SOURCE,
            filter: ["==", ["get", "kind"], "outside_parent"],
            paint: {
                "fill-pattern": HATCH_IMAGE_ID,
                "fill-opacity": 0.85,
            },
        });
    }
    if (!map.getLayer(BR_LABELS_LAYER)) {
        map.addLayer({
            id: BR_LABELS_LAYER,
            type: "symbol",
            source: BR_LABELS_SOURCE,
            layout: {
                "text-field": ["get", "label"],
                "text-size": 11,
                "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
                "text-allow-overlap": false,
                "text-optional": true,
            },
            paint: {
                "text-color": "#0f172a",
                "text-halo-color": "#ffffff",
                "text-halo-width": 1.2,
            },
        });
    }
}

function setSourceData(map: MaplibreMap, id: string, data: GeoJSON.FeatureCollection) {
    const source = map.getSource(id) as GeoJSONSource | undefined;
    source?.setData(data);
}

export type BoundaryReviewNeighbourClick = {
    publicId: string;
    id: string;
    displayName: string;
    type: string | null;
    geometrySource: string | null;
    verificationStatus: string | null;
    lngLat: { lng: number; lat: number };
};

export function syncBoundaryReviewLayers(args: {
    map: MaplibreMap;
    context: AdminAreaBoundaryContext | null;
    draftGeometry?: GeoJSON.Geometry | null;
    toggles: BoundaryReviewToggles;
    issuesGeoJson?: GeoJSON.FeatureCollection | null;
    highlightIssues?: boolean;
}): void {
    const { map, context, toggles } = args;
    if (!map.isStyleLoaded()) {
        return;
    }
    ensureLayers(map);

    const selectedGeom = args.draftGeometry ?? context?.selected.geometry ?? null;
    const selectedFeature =
        selectedGeom && context
            ? {
                  type: "Feature" as const,
                  properties: {
                      role: "selected",
                      public_id: context.selected.public_id,
                      label: formatAdminAreaBoundaryLabel({
                          displayName: context.selected.display_name,
                          type: context.selected.type,
                          publicId: context.selected.public_id,
                      }),
                  },
                  geometry: selectedGeom,
              }
            : null;

    setSourceData(map, BR_SELECTED_SOURCE, {
        type: "FeatureCollection",
        features: selectedFeature ? [selectedFeature] : [],
    });

    const neighbourFeatures =
        toggles.neighbours && context
            ? context.neighbours
                  .map((n) => memberFeature(n, "neighbour"))
                  .filter((f): f is GeoJSON.Feature => f != null)
            : [];
    setSourceData(map, BR_NEIGHBOURS_SOURCE, {
        type: "FeatureCollection",
        features: neighbourFeatures,
    });

    const parentFeature =
        toggles.parentBoundary && context?.parent
            ? memberFeature(context.parent, "parent")
            : null;
    setSourceData(map, BR_PARENT_SOURCE, {
        type: "FeatureCollection",
        features: parentFeature ? [parentFeature] : [],
    });

    const labelMembers: AdminAreaBoundaryMember[] = [];
    if (toggles.labels && context) {
        labelMembers.push(context.selected);
        if (toggles.neighbours) {
            labelMembers.push(...context.neighbours);
        }
        if (toggles.parentBoundary && context.parent) {
            labelMembers.push(context.parent);
        }
    }
    setSourceData(map, BR_LABELS_SOURCE, {
        type: "FeatureCollection",
        features: labelMembers
            .map(labelPointFeature)
            .filter((f): f is GeoJSON.Feature => f != null),
    });

    const issues =
        args.highlightIssues && args.issuesGeoJson
            ? args.issuesGeoJson
            : emptyFc();
    setSourceData(map, BR_ISSUES_SOURCE, issues);

    map.setLayoutProperty(
        BR_NEIGHBOURS_FILL,
        "visibility",
        toggles.neighbours ? "visible" : "none",
    );
    map.setLayoutProperty(
        BR_NEIGHBOURS_LINE,
        "visibility",
        toggles.neighbours ? "visible" : "none",
    );
    map.setLayoutProperty(
        BR_PARENT_LINE,
        "visibility",
        toggles.parentBoundary ? "visible" : "none",
    );
    map.setLayoutProperty(BR_LABELS_LAYER, "visibility", toggles.labels ? "visible" : "none");
}

export function bindNeighbourClickHandler(
    map: MaplibreMap,
    onClick: (payload: BoundaryReviewNeighbourClick) => void,
): () => void {
    const handler = (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature?.properties) {
            return;
        }
        const publicId = String(feature.properties.public_id ?? "");
        if (!publicId) {
            return;
        }
        onClick({
            publicId,
            id: String(feature.properties.id ?? ""),
            displayName: String(feature.properties.display_name ?? ""),
            type: feature.properties.type != null ? String(feature.properties.type) : null,
            geometrySource:
                feature.properties.geometry_source != null
                    ? String(feature.properties.geometry_source)
                    : null,
            verificationStatus:
                feature.properties.verification_status != null
                    ? String(feature.properties.verification_status)
                    : null,
            lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat },
        });
    };

    const enter = () => {
        map.getCanvas().style.cursor = "pointer";
    };
    const leave = () => {
        map.getCanvas().style.cursor = "";
    };

    map.on("click", BR_NEIGHBOURS_FILL, handler);
    map.on("mouseenter", BR_NEIGHBOURS_FILL, enter);
    map.on("mouseleave", BR_NEIGHBOURS_FILL, leave);

    return () => {
        map.off("click", BR_NEIGHBOURS_FILL, handler);
        map.off("mouseenter", BR_NEIGHBOURS_FILL, enter);
        map.off("mouseleave", BR_NEIGHBOURS_FILL, leave);
    };
}

export function showNeighbourPopup(
    map: MaplibreMap,
    payload: BoundaryReviewNeighbourClick,
    onOpenRecord: () => void,
): maplibregl.Popup {
    const root = document.createElement("div");
    root.className = "space-y-1.5 p-1 text-xs text-slate-800";
    root.innerHTML = `
      <div class="font-semibold text-slate-900">${escapeHtml(payload.displayName || "Unnamed")}</div>
      <div class="font-mono text-[10px] text-slate-500">${escapeHtml(payload.publicId)}</div>
      <div>Type: ${escapeHtml(payload.type ?? "—")}</div>
      <div>Source: ${escapeHtml(payload.geometrySource ?? "—")}</div>
      <div>Status: ${escapeHtml(payload.verificationStatus ?? "—")}</div>
    `;
    const button = document.createElement("button");
    button.type = "button";
    button.className =
        "mt-1 rounded border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-900 hover:bg-sky-100";
    button.textContent = "Open record";
    button.addEventListener("click", (ev) => {
        ev.preventDefault();
        onOpenRecord();
    });
    root.appendChild(button);

    return new maplibregl.Popup({ closeButton: true, maxWidth: "240px" })
        .setLngLat([payload.lngLat.lng, payload.lngLat.lat])
        .setDOMContent(root)
        .addTo(map);
}

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}
