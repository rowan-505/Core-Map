import { apiFetch, getDashboardAccessToken } from "@/src/lib/api";

import type {
    AdminGeographyDetail,
    AdminGeographyListParams,
    AdminGeographyPage,
    AdminGeographyPostalRow,
    AdminGeographySummary,
    AdminGeographyTileFilters,
} from "./types";

function appendBool(search: URLSearchParams, key: string, value: boolean | undefined) {
    if (value === undefined) return;
    search.set(key, value ? "true" : "false");
}

export function buildAdminGeographyListQuery(params: AdminGeographyListParams): string {
    const search = new URLSearchParams();
    search.set("limit", String(params.limit ?? 50));
    search.set("offset", String(params.offset ?? 0));
    if (params.q?.trim()) search.set("q", params.q.trim());
    if (params.level) search.set("level", params.level);
    if (params.type) search.set("type", params.type);
    if (params.parent) search.set("parent", params.parent);
    if (params.status) search.set("status", params.status);
    if (params.geometrySource) search.set("geometrySource", params.geometrySource);
    if (params.remediationDecision) search.set("remediation_decision", params.remediationDecision);
    if (params.evidenceStatus) search.set("evidence_status", params.evidenceStatus);
    appendBool(search, "official", params.official);
    appendBool(search, "public", params.public);
    return search.toString();
}

/**
 * Tile URL template for MapLibre vector source.
 * Never returns GeoJSON — only MVT tile paths with optional filter query.
 */
export function buildAdminGeographyTileUrlTemplate(filters: AdminGeographyTileFilters = {}): string {
    const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");
    if (!base) {
        throw new Error("NEXT_PUBLIC_API_BASE_URL is required for admin geography tiles.");
    }
    const search = new URLSearchParams();
    if (filters.level) search.set("level", filters.level);
    if (filters.type) search.set("type", filters.type);
    if (filters.status) search.set("status", filters.status);
    if (filters.geometry_source) search.set("geometry_source", filters.geometry_source);
    appendBool(search, "official", filters.official);
    appendBool(search, "public", filters.public);
    const qs = search.toString();
    return `${base}/admin-areas/tiles/{z}/{x}/{y}${qs ? `?${qs}` : ""}`;
}

/** True when a URL is an admin-areas MVT request (used by transformRequest + tests). */
export function isAdminGeographyTileUrl(url: string): boolean {
    return url.includes("/admin-areas/tiles/");
}

/** True when a fetch path would load bulk GeoJSON (forbidden for filter changes). */
export function wouldFetchNationwideGeoJson(path: string): boolean {
    const lower = path.toLowerCase();
    if (lower.includes("/admin-areas/tiles/")) return false;
    if (/\/admin-areas\/[^/?]+\/context(?:\?|$)/i.test(lower)) return false;
    if (/\/admin-areas\/[^/?]+\/validate-geometry(?:\?|$)/i.test(lower)) return false;
    if (lower.includes("include_geometry=true") && !/\/admin-areas\/[^/?]+(?:\?|$)/.test(lower)) {
        return true;
    }
    if (lower.includes("format=geojson") || lower.includes("as_geojson=true")) return true;
    if (/\/admin-areas\b/.test(lower) && lower.includes("geometry=full")) return true;
    return false;
}

export function listAdminGeography(
    params: AdminGeographyListParams,
    init?: { signal?: AbortSignal },
): Promise<AdminGeographyPage> {
    const qs = buildAdminGeographyListQuery(params);
    return apiFetch<AdminGeographyPage>(`/admin-areas?${qs}`, {
        method: "GET",
        signal: init?.signal,
    });
}

export function getAdminGeographySummary(init?: { signal?: AbortSignal }): Promise<AdminGeographySummary> {
    return apiFetch<AdminGeographySummary>("/admin-areas/summary", {
        method: "GET",
        signal: init?.signal,
    });
}

export function getAdminGeographyDetail(
    id: string,
    options?: { includeGeometry?: boolean; signal?: AbortSignal },
): Promise<AdminGeographyDetail> {
    const search = new URLSearchParams();
    if (options?.includeGeometry) {
        search.set("include_geometry", "true");
    }
    const qs = search.toString();
    return apiFetch<AdminGeographyDetail>(`/admin-areas/${id}${qs ? `?${qs}` : ""}`, {
        method: "GET",
        signal: options?.signal,
    });
}

export function listAdminGeographyChildren(
    id: string,
    params?: { limit?: number; offset?: number; level?: string; signal?: AbortSignal },
): Promise<{ items: { id: string; canonical_name: string; admin_level_code: string; is_active: boolean }[]; total: number }> {
    const search = new URLSearchParams();
    search.set("limit", String(params?.limit ?? 100));
    search.set("offset", String(params?.offset ?? 0));
    if (params?.level) search.set("level", params.level);
    return apiFetch(`/admin-areas/${id}/children?${search.toString()}`, {
        method: "GET",
        signal: params?.signal,
    });
}

export function listAdminGeographyPostalCodes(
    id: string,
    params?: { limit?: number; offset?: number; q?: string; signal?: AbortSignal },
): Promise<{ items: AdminGeographyPostalRow[]; total: number }> {
    const search = new URLSearchParams();
    search.set("limit", String(params?.limit ?? 20));
    search.set("offset", String(params?.offset ?? 0));
    if (params?.q?.trim()) search.set("q", params.q.trim());
    return apiFetch(`/admin-areas/${id}/postal-codes?${search.toString()}`, {
        method: "GET",
        signal: params?.signal,
    });
}

export function searchPostalCodes(
    params: { q?: string; limit?: number; offset?: number; signal?: AbortSignal },
): Promise<{ items: AdminGeographyPostalRow[]; total: number }> {
    const search = new URLSearchParams();
    search.set("limit", String(params.limit ?? 20));
    search.set("offset", String(params.offset ?? 0));
    if (params.q?.trim()) search.set("q", params.q.trim());
    return apiFetch(`/postal-codes?${search.toString()}`, {
        method: "GET",
        signal: params.signal,
    });
}

export type PatchAdminGeographyGeometryBody = {
    geometry: {
        type: "Polygon" | "MultiPolygon";
        coordinates: unknown;
    };
    expected_updated_at: string;
    geometry_source?: "coremap_manual" | "government" | "osm";
};

export type PatchAdminGeographyGeometryResult = {
    id: string;
    public_id: string;
    canonical_name: string;
    geometry_source: string | null;
    source_license_status: string | null;
    verification_status: string;
    updated_at: string;
    bbox: number[] | null;
    centroid: unknown | null;
    geometry: unknown | null;
    replaced_mimu_placeholder: boolean;
};

export async function patchAdminGeographyGeometry(
    id: string,
    body: PatchAdminGeographyGeometryBody,
): Promise<PatchAdminGeographyGeometryResult> {
    return apiFetch<PatchAdminGeographyGeometryResult>(`/admin-areas/${id}/geometry`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

export type PatchAdminGeographyRemediationBody = {
    expected_updated_at: string;
    decision: import("./types").RemediationDecision;
    geometry?: {
        type: "Polygon" | "MultiPolygon";
        coordinates: unknown;
    };
    geometry_source?: "coremap_manual" | "government" | "osm";
    evidence?: import("./types").RemediationEvidence | null;
    verification_note?: string | null;
    is_public_usable?: boolean;
};

export type PatchAdminGeographyRemediationResult = {
    id: string;
    public_id: string;
    canonical_name: string;
    geometry_source: string | null;
    source_license_status: string | null;
    verification_status: string;
    verification_note: string | null;
    remediation_decision: string | null;
    evidence: import("./types").RemediationEvidence | null;
    is_public_usable: boolean | null;
    public_eligible: boolean;
    publication_gate: string;
    updated_at: string;
    bbox: number[] | null;
    centroid: unknown | null;
    geometry: unknown | null;
};

export async function patchAdminGeographyRemediation(
    id: string,
    body: PatchAdminGeographyRemediationBody,
): Promise<PatchAdminGeographyRemediationResult> {
    return apiFetch<PatchAdminGeographyRemediationResult>(`/admin-areas/${id}/remediation`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

/** Sync Bearer header for MapLibre tile requests. */
export function adminGeographyTileAuthHeaders(): Record<string, string> {
    const token = getDashboardAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}
