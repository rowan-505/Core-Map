/**
 * Shared helpers for admin-area boundary context / draft validation.
 * Gaps between neighbours are never treated as fatal errors.
 */

/** Degrees added around selected bbox when loading same-level neighbours. */
export const BOUNDARY_CONTEXT_BBOX_MARGIN_DEG = 0.02;

/** Cap neighbour GeoJSON payloads — never nationwide. */
export const BOUNDARY_CONTEXT_NEIGHBOUR_LIMIT = 40;

/** Simplify neighbours for map context (degrees). Selected stays full-resolution. */
export const BOUNDARY_CONTEXT_NEIGHBOUR_SIMPLIFY_DEG = 0.001;

/** Ignore tiny slivers from float / topology noise (hectares). */
export const BOUNDARY_AREA_EPSILON_HA = 0.01;

export type BoundaryCheckSeverity = "pass" | "warning" | "fail";

export type BoundaryCheckRow = {
    id: "st_is_valid" | "outside_parent" | "overlaps" | "touching";
    severity: BoundaryCheckSeverity;
    message: string;
};

export function m2ToHectares(m2: number | null | undefined): number {
    if (m2 == null || !Number.isFinite(m2)) {
        return 0;
    }
    return Math.round((m2 / 10_000) * 1000) / 1000;
}

export function buildBoundaryChecks(input: {
    isValid: boolean;
    invalidReason: string | null;
    outsideParentHa: number | null;
    overlappingCount: number;
    overlappingTotalHa: number;
    touchingNeighbourCount: number;
    hasParent: boolean;
}): BoundaryCheckRow[] {
    const checks: BoundaryCheckRow[] = [];

    if (!input.isValid) {
        checks.push({
            id: "st_is_valid",
            severity: "fail",
            message: input.invalidReason?.trim()
                ? `Invalid geometry: ${input.invalidReason}`
                : "Geometry failed ST_IsValid.",
        });
    } else {
        checks.push({
            id: "st_is_valid",
            severity: "pass",
            message: "Geometry is valid (ST_IsValid).",
        });
    }

    if (!input.hasParent) {
        checks.push({
            id: "outside_parent",
            severity: "pass",
            message: "No parent boundary to compare.",
        });
    } else if ((input.outsideParentHa ?? 0) > BOUNDARY_AREA_EPSILON_HA) {
        checks.push({
            id: "outside_parent",
            severity: "warning",
            message: `${input.outsideParentHa} ha of draft lies outside the parent boundary.`,
        });
    } else {
        checks.push({
            id: "outside_parent",
            severity: "pass",
            message: "Draft stays inside the parent boundary (within tolerance).",
        });
    }

    if (input.overlappingCount > 0) {
        checks.push({
            id: "overlaps",
            severity: "warning",
            message: `Overlaps ${input.overlappingCount} neighbour(s) (${input.overlappingTotalHa} ha total).`,
        });
    } else {
        checks.push({
            id: "overlaps",
            severity: "pass",
            message: "No material overlap with same-level neighbours.",
        });
    }

    checks.push({
        id: "touching",
        severity: "pass",
        message:
            input.touchingNeighbourCount > 0
                ? `Touches ${input.touchingNeighbourCount} neighbour(s). Ordinary gaps are not treated as errors.`
                : "No touching neighbours in the local bbox (gaps are not fatal).",
    });

    return checks;
}

/** Blank or generic admin names — warn only; never auto-rename. */
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

export function formatAdminAreaLabel(input: {
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

export function resolveAdminAreaLookup(publicIdOrId: string): {
    kind: "id" | "public_id";
    id?: bigint;
    publicId?: string;
} {
    const value = publicIdOrId.trim();
    if (/^\d+$/.test(value)) {
        return { kind: "id", id: BigInt(value) };
    }
    return { kind: "public_id", publicId: value };
}
