/**
 * Shared admin-area boundary review (Core Review editor + Admin Geography map).
 * Gaps between neighbours are never treated as fatal errors.
 */

export type BoundaryCheckSeverity = "pass" | "warning" | "fail";

export type BoundaryCheckRow = {
    id: "st_is_valid" | "outside_parent" | "overlaps" | "touching";
    severity: BoundaryCheckSeverity;
    message: string;
};

export type AdminAreaBoundaryMember = {
    id: string;
    public_id: string;
    display_name: string;
    type: string | null;
    admin_level_code?: string;
    geometry_source: string | null;
    verification_status: string;
    geometry: GeoJSON.Geometry | null;
    bbox: number[] | null;
    name_warning?: boolean;
    parent_id?: string | null;
};

export type AdminAreaBoundaryContext = {
    selected: AdminAreaBoundaryMember;
    parent: AdminAreaBoundaryMember | null;
    neighbours: AdminAreaBoundaryMember[];
    meta: {
        bbox_margin_deg: number;
        neighbour_limit: number;
        neighbour_count: number;
        neighbour_truncated: boolean;
    };
};

export type AdminAreaValidateGeometryResult = {
    is_valid: boolean;
    invalid_reason: string | null;
    outside_parent_ha: number | null;
    overlapping_neighbours: Array<{
        public_id: string;
        display_name: string;
        overlap_ha: number;
    }>;
    touching_neighbour_count: number;
    checks: BoundaryCheckRow[];
    issues_geojson: GeoJSON.FeatureCollection;
};

export type BoundaryReviewToggles = {
    neighbours: boolean;
    labels: boolean;
    parentBoundary: boolean;
};

export const DEFAULT_BOUNDARY_REVIEW_TOGGLES: BoundaryReviewToggles = {
    neighbours: true,
    labels: true,
    parentBoundary: false,
};

const GENERIC_ADMIN_NAMES = new Set(
    ["urban", "rural", "ward", "village tract", "unknown", "unnamed"].map((s) => s.toLowerCase())
);

export function isGenericOrBlankAdminName(name: string | null | undefined): boolean {
    const trimmed = (name ?? "").trim();
    if (!trimmed) {
        return true;
    }
    return GENERIC_ADMIN_NAMES.has(trimmed.toLowerCase());
}

export function formatAdminAreaBoundaryLabel(input: {
    displayName: string | null | undefined;
    type: string | null | undefined;
    publicId: string;
}): string {
    const name = (input.displayName ?? "").trim();
    const type = (input.type ?? "").trim();
    if (!name) {
        return `Unnamed · #${input.publicId}`;
    }
    return type ? `${name} · ${type}` : name;
}

export function adminAreaNameWarningMessage(name: string | null | undefined): string | null {
    if (!isGenericOrBlankAdminName(name)) {
        return null;
    }
    const trimmed = (name ?? "").trim();
    if (!trimmed) {
        return "Name is blank. Add a clearer canonical name before publishing.";
    }
    return `Name "${trimmed}" looks generic. Confirm it is intentional — names are not changed automatically.`;
}
