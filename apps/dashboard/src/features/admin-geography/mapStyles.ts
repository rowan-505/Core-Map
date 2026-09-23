import type { ExpressionSpecification, FillLayerSpecification, LineLayerSpecification } from "maplibre-gl";

export const ADMIN_GEO_SOURCE_ID = "admin-geography-mvt";
export const ADMIN_GEO_SOURCE_LAYER = "admin_areas";
export const ADMIN_GEO_FILL_LAYER = "admin-geography-fill";
export const ADMIN_GEO_LINE_LAYER = "admin-geography-line";
export const ADMIN_GEO_SELECTED_SOURCE = "admin-geography-selected";
export const ADMIN_GEO_SELECTED_FILL = "admin-geography-selected-fill";
export const ADMIN_GEO_SELECTED_LINE = "admin-geography-selected-line";

/** Style keys: official, reference, foreign, needs_fix, placeholder, default. */
export const ADMIN_GEO_COLORS = {
    official: "#0f766e",
    reference: "#7c3aed",
    foreign: "#b45309",
    needs_fix: "#dc2626",
    placeholder: "#ca8a04",
    default: "#475569",
    selected: "#0284c7",
} as const;

/**
 * Paint expression from MVT feature properties:
 * geometry_source, status (verification), is_official_boundary, type_code.
 */
export function adminGeographyFillColorExpr(): ExpressionSpecification {
    return [
        "case",
        ["==", ["get", "geometry_source"], "mimu_placeholder"],
        ADMIN_GEO_COLORS.placeholder,
        ["==", ["get", "status"], "needs_fix"],
        ADMIN_GEO_COLORS.needs_fix,
        [
            "any",
            ["==", ["get", "type_code"], "foreign"],
            ["==", ["get", "geometry_source"], "foreign"],
        ],
        ADMIN_GEO_COLORS.foreign,
        ["==", ["get", "is_official_boundary"], false],
        ADMIN_GEO_COLORS.reference,
        ["==", ["get", "is_official_boundary"], true],
        ADMIN_GEO_COLORS.official,
        ADMIN_GEO_COLORS.default,
    ];
}

export function adminGeographyFillLayer(): FillLayerSpecification {
    return {
        id: ADMIN_GEO_FILL_LAYER,
        type: "fill",
        source: ADMIN_GEO_SOURCE_ID,
        "source-layer": ADMIN_GEO_SOURCE_LAYER,
        minzoom: 5,
        paint: {
            "fill-color": adminGeographyFillColorExpr(),
            "fill-opacity": 0.22,
        },
    };
}

export function adminGeographyLineLayer(): LineLayerSpecification {
    return {
        id: ADMIN_GEO_LINE_LAYER,
        type: "line",
        source: ADMIN_GEO_SOURCE_ID,
        "source-layer": ADMIN_GEO_SOURCE_LAYER,
        minzoom: 5,
        paint: {
            "line-color": adminGeographyFillColorExpr(),
            "line-width": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5,
                0.6,
                10,
                1.2,
                14,
                2,
            ],
            "line-opacity": 0.85,
        },
    };
}

export function geometrySourceBadgeClass(source: string | null | undefined): string {
    if (source === "mimu_placeholder") {
        return "border-amber-400 bg-amber-100 text-amber-950";
    }
    if (source === "foreign") {
        return "border-orange-400 bg-orange-100 text-orange-950";
    }
    return "border-slate-300 bg-slate-100 text-slate-700";
}

export function verificationBadgeClass(status: string): string {
    if (status === "needs_fix") return "border-red-300 bg-red-100 text-red-900";
    if (status === "verified") return "border-emerald-300 bg-emerald-100 text-emerald-900";
    return "border-slate-300 bg-slate-100 text-slate-700";
}

export function postalMatchBadgeClass(status: string): string {
    if (status === "linked_local_area") return "border-emerald-300 bg-emerald-50 text-emerald-900";
    if (status === "linked_township_only") return "border-sky-300 bg-sky-50 text-sky-900";
    if (status === "unmatched" || status === "ambiguous") {
        return "border-amber-300 bg-amber-50 text-amber-950";
    }
    return "border-slate-300 bg-slate-50 text-slate-700";
}
