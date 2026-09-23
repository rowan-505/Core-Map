import { apiFetch } from "@/src/lib/api";

import type {
    AdminAreaBoundaryContext,
    AdminAreaValidateGeometryResult,
} from "./types";

export function getAdminAreaBoundaryContext(
    publicId: string,
    init?: { signal?: AbortSignal },
): Promise<AdminAreaBoundaryContext> {
    return apiFetch<AdminAreaBoundaryContext>(
        `/admin-areas/${encodeURIComponent(publicId)}/context`,
        {
            method: "GET",
            signal: init?.signal,
        },
    );
}

export function validateAdminAreaGeometry(
    publicId: string,
    geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown },
    init?: { signal?: AbortSignal },
): Promise<AdminAreaValidateGeometryResult> {
    return apiFetch<AdminAreaValidateGeometryResult>(
        `/admin-areas/${encodeURIComponent(publicId)}/validate-geometry`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ geometry }),
            signal: init?.signal,
        },
    );
}

/** Guard: context path must target a single area, never list/nationwide GeoJSON. */
export function isAdminAreaBoundaryContextPath(path: string): boolean {
    return /\/admin-areas\/[^/?]+\/context(?:\?|$)/i.test(path);
}
