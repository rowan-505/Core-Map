import {
    clearAuthTokens,
    getAccessToken,
    restoreAccessTokenFromOtherTabs,
    setAccessToken,
} from "./authTokenStorage";
import type { CoreReviewVerificationStatusFilter } from "@/src/features/core-review/verification/coreReviewVerificationFilter";

export { getAccessToken, setAccessToken, clearAuthTokens };

type QueryValue = string | number | boolean | null | undefined;

/** True when `fetch` was aborted (Strict Mode remount, navigation, dependency change). */
export function isAbortError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    return (error as { name?: string }).name === "AbortError";
}

export type Place = {
    id: string;
    public_id: string;
    primary_name: string;
    secondary_name: string | null;
    name_local: string | null;
    display_name: string;
    myanmarName: string | null;
    englishName: string | null;
    /** Optional API fields (snake/camel variants) — used by dashboard preview labels when present */
    nameMm?: string | null;
    nameEn?: string | null;
    myanmar_name?: string | null;
    english_name?: string | null;
    name_mm?: string | null;
    name_en?: string | null;
    category_id: string;
    admin_area_id: string | null;
    lat: number;
    lng: number;
    is_public: boolean;
    is_verified: boolean;
    names: PlaceName[];
    category_name: string | null;
    admin_area_name: string | null;
    /** ISO timestamps from GET /places (list and detail). */
    created_at: string;
    updated_at: string;
};

export type PlaceContact = {
    phone: string | null;
    website: string | null;
    facebook_url: string | null;
    email: string | null;
    opening_hours: string | null;
};

export type PlacePrimaryAddress = {
    public_id: string;
    full_address: string;
    house_number: string | null;
    street_name: string | null;
    quarter: string | null;
    suburb: string | null;
    township: string | null;
    city: string | null;
    district: string | null;
    state_region: string | null;
    postal_code: string | null;
};

export type PlaceDetail = Place & {
    plus_code: string | null;
    importance_score: number | null;
    popularity_score: number | null;
    confidence_score: number | null;
    source_type_id: string;
    publish_status_id: string | null;
    verification_note?: string | null;
    contact?: PlaceContact | null;
    primary_address?: PlacePrimaryAddress | null;
};

export type PlaceName = {
    id: string;
    name: string;
    language_code: string | null;
    script_code: string | null;
    name_type: string;
    is_primary: boolean;
    search_weight: number;
};

export type PlacesParams = {
    q?: string;
    category?: string;
    is_public?: boolean;
    is_verified?: boolean;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
};

/** Max `limit` for GET /places (API rejects values above this). */
export const PLACES_LIST_LIMIT = 100;

export type Category = {
    id: string;
    code: string;
    name: string;
    name_mm: string | null;
    sort_order: number;
};

export type AdminArea = {
    id: string;
    parent_id: string | null;
    admin_level_id: string;
    canonical_name: string;
    slug: string;
    is_active: boolean;
};

export type PlaceFormOption = {
    id: string;
    label?: string;
    code?: string;
    name?: string | null;
    name_mm?: string | null;
    parent_id?: string | null;
    sort_order?: number;
    is_public?: boolean;
    is_searchable?: boolean;
};

export type PlaceFormOptions = {
    categories: PlaceFormOption[];
    admin_areas: PlaceFormOption[];
    source_types: PlaceFormOption[];
    publish_statuses: PlaceFormOption[];
};

/** Body for POST /places — field names match the API */
export type CreatePlacePayload = {
    myanmarName?: string;
    englishName?: string;
    categoryId: string;
    adminAreaId?: string | null;
    explicitClearAdminArea?: boolean;
    lat: number;
    lng: number;
    plusCode?: string | null;
    importanceScore?: number;
    popularityScore?: number;
    confidenceScore?: number;
    isPublic?: boolean;
    /** @deprecated Send verification_status instead */
    isVerified?: boolean;
    verification_status?: string;
    verification_note?: string | null;
    sourceTypeId?: string | null;
    publishStatusId?: string | null;
};

export type UpdatePlacePayload = Partial<CreatePlacePayload>;

/** GeoJSON from API (existing OSM rows may be MultiLineString). */
export type StreetGeometry =
    | {
          type: "LineString";
          coordinates: number[][];
      }
    | {
          type: "MultiLineString";
          coordinates: number[][][];
      }
    | null;

/** Payload for POST/PATCH centerline (API accepts LineString only). */
export type StreetLineStringGeoJson = {
    type: "LineString";
    coordinates: number[][];
};

export type Street = {
    public_id: string;
    canonical_name: string;
    myanmarName: string | null;
    englishName: string | null;
    names: StreetName[];
    admin_area_id: string | null;
    admin_area_name: string | null;
    source_type_id?: string;
    road_class_id: string | null;
    road_class: string | null;
    road_class_name: string | null;
    surface: string | null;
    travel_direction: "forward" | "reverse" | "reversible" | "alternating" | "unknown" | null;
    /** @deprecated Derived from travel_direction. */
    is_oneway: boolean;
    bridge: boolean;
    tunnel: boolean;
    manual_override: boolean;
    edit_status: string;
    routing_status: string;
    deleted_at: string | null;
    last_edited_at: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    geometry: StreetGeometry;
};

export type StreetDetail = Street;

export type UpdateStreetPayload = {
    myanmarName?: string;
    englishName?: string;
    admin_area_id?: string | null;
    admin_area_manual_override?: boolean;
    geometry?: StreetLineStringGeoJson;
    road_class_id?: string | null;
    travel_direction?: "both" | "forward" | "reverse" | "reversible" | "alternating" | "unknown" | null;
    /** @deprecated Prefer travel_direction. */
    is_oneway?: boolean;
    surface?: string | null;
    edit_reason?: string;
    bridge?: boolean;
    tunnel?: boolean;
    verification_status?: string;
};

export type CreateStreetPayload = {
    myanmarName?: string;
    englishName?: string;
    admin_area_id?: string | null;
    road_class_id: string;
    travel_direction?: "both" | "forward" | "reverse" | "reversible" | "alternating" | "unknown" | null;
    /** @deprecated Prefer travel_direction. */
    is_oneway?: boolean;
    surface?: string | null;
    bridge?: boolean;
    tunnel?: boolean;
    verification_status?: string;
    geometry: StreetLineStringGeoJson;
};

export type DeleteStreetPayload = {
    edit_reason?: string;
};

export type RoadClassOption = {
    id: string;
    code: string;
    name: string;
    rank: number;
};

export type StreetName = {
    id: string;
    name: string;
    language_code: string | null;
    script_code: string | null;
    name_type: string;
    is_primary: boolean;
};

export type StreetsParams = {
    limit?: number;
    q?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    /** When true, include soft-deleted streets. */
    include_deleted?: boolean;
};

/** GET /streets/nearby — lightweight map-editor overlay rows. */
export type NearbyStreet = Pick<
    Street,
    | "public_id"
    | "canonical_name"
    | "myanmarName"
    | "englishName"
    | "road_class"
    | "is_active"
    | "deleted_at"
    | "geometry"
>;

export type NearbyStreetsParams = {
    /** minLng,minLat,maxLng,maxLat (EPSG:4326) */
    bbox: string;
    limit?: number;
};

/** GET /streets/nearest-point — `street_id` is core street `public_id` (UUID). */
export type NearestStreetPointHit = {
    street_id: string;
    nearest: { lng: number; lat: number };
    distance_m: number;
    street_name: string | null;
    road_class: string | null;
};

/** POST /streets/validate-geometry — camelCase response. */
export type StreetGeometryConnectionApi = {
    streetId: string;
    nearest: { lng: number; lat: number };
    distanceM: number;
    streetName: string | null;
    roadClass: string | null;
} | null;

export type StreetGeometryCrossingApi = {
    streetId: string;
    streetName: string | null;
    roadClass: string | null;
};

export type StreetGeometryDuplicateApi = StreetGeometryCrossingApi & {
    kind: "overlap" | "near_duplicate";
};

export type ValidateStreetGeometryResponse = {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    startConnection: StreetGeometryConnectionApi;
    endConnection: StreetGeometryConnectionApi;
    crossings: StreetGeometryCrossingApi[];
    duplicates: StreetGeometryDuplicateApi[];
};

export type BuildingPolygonGeometry = {
    type: "Polygon";
    coordinates: number[][][];
};

export type BuildingMultiPolygonGeometry = {
    type: "MultiPolygon";
    coordinates: number[][][][];
};

export type BuildingGeometry = BuildingPolygonGeometry | BuildingMultiPolygonGeometry;

/** Row from ref.ref_land_area_classes (GET /admin/ref/land-area-classes). */
export type RefLandAreaClass = {
    id: string;
    code: string;
    name_en: string;
    name_mm: string | null;
    parent_id: string | null;
    sort_order: number | null;
    min_zoom: number | null;
    is_active: boolean;
};

/** Row from ref.ref_water_classes (GET /admin/ref/water-classes). */
export type RefWaterClass = {
    id: string;
    code: string;
    name_en: string;
    name_mm: string | null;
    parent_id: string | null;
    sort_order: number | null;
    min_zoom: number | null;
    is_active: boolean;
};

/** Row from ref.ref_boundary_statuses (GET /admin/ref/boundary-statuses). */
export type RefBoundaryStatus = {
    id: string;
    code: string;
    name_en: string;
    name_mm: string | null;
    helper_en: string | null;
    helper_mm: string | null;
    sort_order: number;
    default_is_official_boundary: boolean;
    default_boundary_confidence_score: number;
    default_address_usage_code: string | null;
    is_active: boolean;
};

/** Row from ref.ref_address_usage_types (GET /admin/ref/address-usage-types). */
export type RefAddressUsageType = {
    id: string;
    code: string;
    name_en: string;
    name_mm: string | null;
    helper_en: string | null;
    helper_mm: string | null;
    sort_order: number;
    is_active: boolean;
};

/** Row from ref.ref_building_types (GET /building-types and embedded on buildings). */
export type RefBuildingType = {
    id: string;
    code: string;
    name: string;
    name_mm: string | null;
    parent_id: string | null;
    /** Present on GET /building-types; omitted on embedded building references. */
    sort_order?: number;
};

/** Embedded admin area on building API responses. */
export type BuildingAdminAreaRef = {
    id: string;
    canonical_name: string;
    slug: string;
};

export type BuildingNameEntry = {
    id?: number;
    name: string;
    languageCode: "my" | "en" | "und";
    scriptCode?: string | null;
    nameType: "official" | "alternate" | "short" | "local" | "old" | "imported";
    isPrimary: boolean;
    searchWeight: number;
};

export type Building = {
    id: string;
    public_id: string;
    external_id: string | null;
    name_mm?: string | null;
    name_en?: string | null;
    fallback_name?: string | null;
    /** Coalesced display label from names table priority. */
    name: string | null;
    /** Canonical multilingual names from core_building_names. */
    names?: BuildingNameEntry[];
    /** FK to ref.ref_building_types (when exposed by API). */
    building_type_id?: string | null;
    /** Resolved taxonomy; null when not linked to ref or inactive. */
    building_type: RefBuildingType | null;
    /** From ref join (flat); use for display when building_type object is null. */
    building_type_code?: string | null;
    building_type_name?: string | null;
    building_type_name_mm?: string | null;
    /** Optional FK to core.core_admin_areas. */
    admin_area_id?: string | null;
    admin_area?: BuildingAdminAreaRef | null;
    class_code: string;
    normalized_data: Record<string, unknown>;
    source_refs: Record<string, unknown>;
    levels: number | null;
    height_m: number | null;
    area_m2: number | null;
    confidence_score: number | null;
    is_verified: boolean;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    /** Omitted in some list responses — fetch `GET /buildings/:id` for full footprint when missing. */
    geometry?: BuildingGeometry | null;
};

/** Default/max `limit` for GET /buildings (aligned with API default 100). */
export const BUILDINGS_LIST_LIMIT = 100;

export type BuildingsParams = {
    q?: string;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
};

export type DataReviewGeoJson = Record<string, unknown>;

export type DeleteBuildingResponse = {
    ok: boolean;
    deleted: boolean;
    public_id: string;
};

export type PlaceBuildingRelationType = "inside" | "entrance" | "nearby" | "compound";

export type LinkedBuildingSummaryApi = {
    relation_type: string;
    is_primary: boolean;
    created_at: string;
    building: {
        public_id: string;
        name: string | null;
        building_type_id?: string | null;
        building_type: RefBuildingType | null;
        building_type_code?: string | null;
        building_type_name?: string | null;
        building_type_name_mm?: string | null;
        class_code: string;
        area_m2: number | null;
        admin_area?: BuildingAdminAreaRef | null;
    };
};

export type LinkedPlaceSummaryApi = {
    relation_type: string;
    is_primary: boolean;
    created_at: string;
    place: {
        public_id: string;
        primary_name: string | null;
        display_name: string | null;
        lat?: number | null;
        lng?: number | null;
        category_name: string | null;
    };
};

export type LinkedPlacesForBuildingResponse = {
    items: LinkedPlaceSummaryApi[];
};

export type LinkedPlaceBuildingListResponse = {
    items: LinkedBuildingSummaryApi[];
};

export type LinkPlaceBuildingPayload = {
    building_id: string;
    relation_type?: PlaceBuildingRelationType;
    is_primary?: boolean;
};

export type PatchPlaceBuildingPayload = {
    relation_type?: PlaceBuildingRelationType;
    is_primary?: boolean;
};

/** POST /places/:id/buildings */
export type LinkPlaceBuildingResponse = LinkedBuildingSummaryApi & {
    place_id: string;
};

/** PATCH /places/:id/buildings/:buildingId */
export type PatchPlaceBuildingResponse = LinkPlaceBuildingResponse;

/** POST/PATCH bodies — snake_case matches API JSON */
export type CreateBuildingPayload = {
    geometry: BuildingGeometry;
    /** Compatibility input normalized by the API into core_building_names. */
    name?: string | null;
    name_mm?: string | null;
    name_en?: string | null;
    /** Prefer {@link building_type_id} when both are set (API resolves ref codes). */
    building_type?: string;
    /** Omit or null: create omits; PATCH may send null to clear FK. */
    building_type_id?: string | null;
    /** Omit, set, or null (PATCH) to clear. */
    admin_area_id?: string | null;
    explicitClearAdminArea?: boolean;
    levels?: number;
    height_m?: number;
    confidence_score?: number;
    /** @deprecated Send verification_status instead */
    is_verified?: boolean;
    verification_status?: string;
};

export type UpdateBuildingPayload = Partial<CreateBuildingPayload>;

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

function getApiBaseUrl(): string {
    if (!API_BASE_URL) {
        throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured.");
    }

    return API_BASE_URL.replace(/\/+$/, "");
}

function buildUrl(path: string, params?: Record<string, QueryValue>): string {
    const url = new URL(path, `${getApiBaseUrl()}/`);

    if (!params) {
        return url.toString();
    }

    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "") {
            continue;
        }

        url.searchParams.set(key, String(value));
    }

    return url.toString();
}

/**
 * Single in-flight refresh shared by all concurrent 401s so a burst of expired
 * requests triggers exactly one POST /auth/refresh (refresh-token rotation means
 * only the first call holds a valid token; the rest must reuse its result).
 */
let refreshInFlight: Promise<boolean> | null = null;

/** Read the stored dashboard access JWT (browser only). */
export function getDashboardAccessToken(): string | null {
    return getAccessToken();
}

function isAccessTokenExpiredOrStale(token: string, skewSeconds = 45): boolean {
    try {
        const parts = token.split(".");
        if (parts.length < 2 || !parts[1]) return true;
        const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
        const payload = JSON.parse(json) as { exp?: unknown };
        if (typeof payload.exp !== "number") return false;
        return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
    } catch {
        return true;
    }
}

/**
 * Exchanges the stored refresh token for a new access + refresh token pair and
 * persists both (rotation). Returns false when no/invalid refresh token exists.
 * Uses a raw fetch so it never recurses through {@link apiFetch}.
 */
async function refreshSession(): Promise<boolean> {
    if (typeof window === "undefined") {
        return false;
    }

    if (!refreshInFlight) {
        refreshInFlight = (async () => {
            try {
                const response = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({}),
                });

                if (!response.ok) {
                    return false;
                }

                const data = (await response.json()) as {
                    accessToken?: string;
                };

                if (!data.accessToken) {
                    return false;
                }

                setAccessToken(data.accessToken);
                return true;
            } catch {
                return false;
            } finally {
                refreshInFlight = null;
            }
        })();
    }

    return refreshInFlight;
}

/**
 * Returns a usable access token, refreshing when missing/expired.
 * Used by MapLibre lifecycle tiles (transformRequest is sync — call this before tile load).
 */
export async function ensureDashboardAccessToken(): Promise<string | null> {
    const current = getAccessToken();
    if (current && !isAccessTokenExpiredOrStale(current)) {
        return current;
    }
    const refreshed = await refreshSession();
    if (!refreshed) {
        return getAccessToken();
    }
    return getAccessToken();
}

/**
 * Revokes the server session (best-effort) and clears both tokens, then sends the
 * admin to the login page. Safe to call even if no refresh token is stored.
 */
export async function logout(): Promise<void> {
    try {
        await fetch(`${getApiBaseUrl()}/auth/logout`, {
            method: "POST",
            credentials: "include",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
        });
    } catch {
        // Best-effort server revoke; always clear locally below.
    }

    clearAuthTokens();
    redirectToLogin("logout");
}

export type AuthMeProfile = {
    public_id: string;
    email: string;
    display_name: string;
    phone: string | null;
    roles: string[];
    email_verified: boolean;
    account_status: string;
    primary_region_id: string | null;
    preferred_language: string;
    total_points: number;
};

export function getAuthMe(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<AuthMeProfile>("/auth/me", { method: "GET", ...fetchInit });
}

export async function tryRestoreDashboardSession(): Promise<boolean> {
    const fromOpenTab = await restoreAccessTokenFromOtherTabs();
    if (fromOpenTab) {
        return true;
    }
    return refreshSession();
}

const jsonHeaders = { "Content-Type": "application/json" };

export function changeDashboardPassword(currentPassword: string, newPassword: string) {
    return apiFetch<{ message: string }>("/auth/password/change", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ currentPassword, newPassword }),
    });
}

export function listDashboardSessions() {
    return apiFetch<{
        sessions: {
            public_id: string;
            current: boolean;
            created_at: string;
            last_used_at: string | null;
            device_label: string;
        }[];
    }>("/auth/sessions");
}

export function listDashboardSecurityEvents() {
    return apiFetch<{
        events: {
            event_type: string;
            success: boolean;
            provider: string | null;
            created_at: string;
            ip_address: string | null;
        }[];
    }>("/auth/security-events");
}

export function revokeDashboardSession(publicId: string) {
    return apiFetch<{ message: string }>(`/auth/sessions/${publicId}`, { method: "DELETE" });
}

export function revokeOtherDashboardSessions() {
    return apiFetch<{ message: string }>("/auth/sessions/revoke-others", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({}),
    });
}

export function enrollDashboardMfa() {
    return apiFetch<{ secret: string; otpauthUrl: string }>("/auth/mfa/enroll", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({}),
    });
}

export function verifyDashboardMfaEnroll(code: string) {
    return apiFetch<{ recoveryCodes: string[] }>("/auth/mfa/enroll/verify", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ code }),
    });
}


function redirectToLogin(_reason: string) {
    if (typeof window === "undefined") {
        return;
    }

    const pathname = window.location.pathname;

    if (pathname === "/login") {
        return;
    }

    // Preserve the page the user was opening (e.g. Edit Place in a new tab) so
    // post-login / session-restore does not dump them on /dashboard/account.
    const next = `${pathname}${window.location.search}${window.location.hash}`;
    const loginUrl =
        next.startsWith("/dashboard")
            ? `/login?next=${encodeURIComponent(next)}`
            : "/login";
    window.location.replace(loginUrl);
}

/** Formats API `issues` from Zod `.flatten()` or `{ path, message }[]` (e.g. building geometry validation). */
function formatApiIssuesBlock(issues: unknown): string {
    if (issues === undefined || issues === null) {
        return "";
    }

    if (Array.isArray(issues)) {
        const lines: string[] = [];

        for (const item of issues) {
            if (item && typeof item === "object" && !Array.isArray(item)) {
                const rec = item as { path?: unknown; message?: unknown };
                const path = typeof rec.path === "string" && rec.path.trim() ? rec.path.trim() : "";
                const msg = typeof rec.message === "string" && rec.message.trim() ? rec.message.trim() : "";

                if (path && msg) {
                    lines.push(`• ${path}: ${msg}`);
                } else if (msg) {
                    lines.push(`• ${msg}`);
                } else {
                    lines.push(`• ${JSON.stringify(item)}`);
                }
            } else {
                lines.push(`• ${String(item)}`);
            }
        }

        return lines.join("\n");
    }

    if (typeof issues === "object") {
        const o = issues as { formErrors?: unknown; fieldErrors?: Record<string, unknown> };
        const lines: string[] = [];

        if (Array.isArray(o.formErrors)) {
            for (const fe of o.formErrors) {
                if (typeof fe === "string" && fe.trim()) {
                    lines.push(`• ${fe.trim()}`);
                }
            }
        }

        if (o.fieldErrors && typeof o.fieldErrors === "object") {
            for (const [field, errs] of Object.entries(o.fieldErrors)) {
                if (Array.isArray(errs)) {
                    for (const err of errs) {
                        if (typeof err === "string" && err.trim()) {
                            lines.push(`• ${field}: ${err.trim()}`);
                        }
                    }
                }
            }
        }

        return lines.join("\n");
    }

    return `• ${String(issues)}`;
}

async function getErrorMessage(response: Response): Promise<string> {
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
        let data: Record<string, unknown>;

        try {
            data = (await response.json()) as Record<string, unknown>;
        } catch {
            return `Request failed with status ${response.status}`;
        }

        const headline: string[] = [];

        if (typeof data.message === "string" && data.message.trim()) {
            headline.push(data.message.trim());
        }

        if (typeof data.error === "string" && data.error.trim()) {
            headline.push(data.error.trim());
        }

        const issuesBlock = formatApiIssuesBlock(data.issues);

        if (issuesBlock) {
            return headline.length > 0 ? `${headline.join(" — ")}\n\n${issuesBlock}` : issuesBlock;
        }

        const extraBullets: string[] = [];

        if (Array.isArray(data.errors)) {
            for (const entry of data.errors) {
                if (typeof entry === "string" && entry.trim()) {
                    extraBullets.push(`✗ ${entry.trim()}`);
                }
            }
        }

        if (Array.isArray(data.warnings)) {
            for (const entry of data.warnings) {
                if (typeof entry === "string" && entry.trim()) {
                    extraBullets.push(`⚠ ${entry.trim()}`);
                }
            }
        }

        const extraBlock =
            extraBullets.length > 0
                ? extraBullets.length <= 30
                    ? extraBullets.join("\n")
                    : `${extraBullets.slice(0, 25).join("\n")}\n…(+${extraBullets.length - 25} more)`
                : "";

        if (extraBlock) {
            return headline.length > 0 ? `${headline.join(" — ")}\n\n${extraBlock}` : extraBlock;
        }

        if (headline.length > 0) {
            return headline.join(" — ");
        }

        return JSON.stringify(data);
    }

    const text = await response.text();

    if (text.trim()) {
        return text;
    }

    return `Request failed with status ${response.status}`;
}

export async function apiFetch<T>(
    path: string,
    init: RequestInit = {},
    params?: Record<string, QueryValue>
): Promise<T> {
    // `allowRefresh` guards against infinite loops: a 401 triggers at most one
    // /auth/refresh + retry; the retried call passes `false`.
    return apiFetchInternal<T>(path, init, params, true);
}

async function apiFetchInternal<T>(
    path: string,
    init: RequestInit = {},
    params: Record<string, QueryValue> | undefined,
    allowRefresh: boolean
): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");

    const accessToken = getAccessToken();

    if (accessToken) {
        headers.set("Authorization", `Bearer ${accessToken}`);
    }

    if (!accessToken) {
        // New tabs have an empty memory JWT. Reuse a token from an open
        // dashboard tab, then cookie refresh, before bouncing to /login.
        if (allowRefresh) {
            const fromOpenTab = await restoreAccessTokenFromOtherTabs();
            if (fromOpenTab) {
                return apiFetchInternal<T>(path, init, params, true);
            }
            const refreshed = await refreshSession();
            if (refreshed) {
                return apiFetchInternal<T>(path, init, params, false);
            }
        }
        redirectToLogin("missing-credentials");
        throw new Error("Authentication required");
    }

    const response = await fetch(buildUrl(path, params), {
        ...init,
        credentials: "include",
        headers,
    });

    if (response.status === 401) {
        // Access token likely expired (short-lived). Try one refresh + retry
        // before clearing the session — only logout if refresh fails.
        if (allowRefresh) {
            const refreshed = await refreshSession();
            if (refreshed) {
                return apiFetchInternal<T>(path, init, params, false);
            }
        }

        clearAuthTokens();
        redirectToLogin("http-401");
        throw new Error("Session expired. Please log in again.");
    }

    if (!response.ok) {
        const message = await getErrorMessage(response);
        throw new Error(message);
    }

    if (response.status === 204) {
        throw new Error("Server returned 204 No Content; expected JSON body.");
    }

    return (await response.json()) as T;
}

export function getPlaces(params?: PlacesParams, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<Place[]>("/places", { method: "GET", ...fetchInit }, params);
}

export function getPlace(id: string, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<PlaceDetail>(`/places/${id}`, { method: "GET", ...fetchInit });
}

export function getPlaceFormOptions() {
    return apiFetch<PlaceFormOptions>("/place-form-options", { method: "GET" });
}

export function updatePlace(id: string, payload: UpdatePlacePayload) {
    return apiFetch<PlaceDetail>(`/places/${id}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function upsertPlaceContact(
    id: string,
    payload: {
        phone?: string | null;
        website?: string | null;
        facebookUrl?: string | null;
        email?: string | null;
        openingHours?: string | null;
    },
) {
    return apiFetch<PlaceContact>(`/places/${id}/contact`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function createPlace(payload: CreatePlacePayload) {
    return apiFetch<PlaceDetail>("/places", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function deletePlace(id: string) {
    return apiFetch<{ success: boolean; public_id: string }>(`/places/${id}`, {
        method: "DELETE",
    });
}

export function getCategories() {
    return apiFetch<Category[]>("/categories", { method: "GET" });
}

export function getAdminAreas(params?: { limit?: number; offset?: number }) {
    const search = new URLSearchParams();
    search.set("limit", String(params?.limit ?? 100));
    if (params?.offset !== undefined) {
        search.set("offset", String(params.offset));
    }
    return apiFetch<{
        items: AdminArea[];
        total: number;
        limit: number;
        offset: number;
    }>(`/admin-areas?${search.toString()}`, { method: "GET" }).then((page) => page.items);
}

export type AdminAreaOption = {
    id: string;
    canonical_name: string;
    name_mm: string | null;
    name_en: string | null;
    admin_level_id: string;
    admin_level_code: string;
    admin_level_name?: string | null;
    parent_id: string | null;
    parent_label?: string | null;
    boundary_status?: string | null;
    address_usage?: string | null;
};

export function getAdminAreaOptions(params?: {
    limit?: number;
    q?: string;
    /** Limit picker to township-level areas (place/road/building manual override). */
    townshipOnly?: boolean;
    /** Limit picker to Region/State (`state_region`) rows. */
    stateRegionOnly?: boolean;
    /**
     * When filtering townships, only return descendants of this Region/State id.
     * Requires townshipOnly (or admin_level_code=township on the API).
     */
    regionAdminAreaId?: string;
}) {
    const search = new URLSearchParams();
    if (params?.limit !== undefined) {
        search.set("limit", String(params.limit));
    }
    if (params?.q?.trim()) {
        search.set("q", params.q.trim());
    }
    if (params?.stateRegionOnly) {
        search.set("admin_level_code", "state_region");
    } else if (params?.townshipOnly) {
        search.set("admin_level_code", "township");
    }
    if (params?.regionAdminAreaId?.trim()) {
        search.set("region_admin_area_id", params.regionAdminAreaId.trim());
    }
    const qs = search.toString();
    return apiFetch<AdminAreaOption[]>(`/admin-areas/options${qs ? `?${qs}` : ""}`, { method: "GET" });
}

/** Road/street manual township override: server-side search, active townships only. */
export function searchRoadTownshipAdminAreaOptions(params: { q: string; limit?: number }) {
    const search = new URLSearchParams();
    search.set("q", params.q.trim());
    search.set("limit", String(params.limit ?? 50));
    return apiFetch<AdminAreaOption[]>(`/admin-areas/road-township-options?${search.toString()}`, {
        method: "GET",
    });
}

export type EntityAdminAreaKind = "place" | "street" | "building" | "land_area" | "bus_stop";

export type RoadAdminAreaInferStatus =
    | "valid_existing"
    | "recommendation_found"
    | "no_match"
    | "invalid_geometry";

export type RoadInferCurrentAdminArea = {
    id: string | null;
    name: string | null;
    level_code: string | null;
    is_active: boolean | null;
};

export type RoadInferRecommendedTownship = {
    id: string;
    name_mm: string | null;
    name_en: string | null;
    canonical_name: string | null;
};

export type RoadTownshipRecommendationMode =
    | "single_overlap"
    | "multi_overlap"
    | "point_fallback"
    | "nearest";

export type RoadTownshipDebugReason =
    | "invalid_geometry"
    | "no_township_polygons"
    | "outside_all_townships"
    | "query_error";

export type RoadInferIntersectingTownship = {
    id: string;
    canonical_name: string;
    name_mm: string | null;
    name_en: string | null;
    admin_level_code: string;
    overlap_m: number;
    overlap_pct: number | null;
};

export type RoadInferCommonParentAdminArea = {
    id: string;
    canonical_name: string;
    admin_level_code: string;
    name_mm: string | null;
    name_en: string | null;
};

export type EntityAdminAreaInferResult = {
    admin_area_id: string | null;
    canonical_name: string | null;
    admin_level_code: string | null;
    name_mm: string | null;
    name_en: string | null;
    geometry_contains: boolean;
    /** Road/street, land_area, and bus_stop infer audit — returned for recommend/apply kinds. */
    status?: RoadAdminAreaInferStatus;
    message?: string | null;
    currentAdminArea?: RoadInferCurrentAdminArea | null;
    recommendedTownship?: RoadInferRecommendedTownship | null;
    recommendationMode?: RoadTownshipRecommendationMode | null;
    intersectingTownships?: RoadInferIntersectingTownship[];
    commonParentAdminArea?: RoadInferCommonParentAdminArea | null;
    debugReason?: RoadTownshipDebugReason | null;
    fallbackReason?: "point_fallback" | "nearest_township" | null;
    nearestTownshipDistanceM?: number | null;
};

export type EntityAdminAreaValidateManualResult = {
    valid: boolean;
    geometry_contains: boolean;
    inferred_admin_area_id: string | null;
    admin_level_code: string | null;
    message: string | null;
    can_save_without_override: boolean;
};

export function inferEntityAdminArea(
    payload: {
        kind: EntityAdminAreaKind;
        lat?: number;
        lng?: number;
        geometry?: { type: string; coordinates: unknown };
        /** Road/land area edit audit: stored admin_area_id from DB. */
        current_admin_area_id?: string;
        /** Road/land area edit audit logging only. */
        entity_public_id?: string;
    },
    fetchInit?: Pick<RequestInit, "signal">,
) {
    return apiFetch<EntityAdminAreaInferResult>(
        "/entity-admin-area/infer",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            ...fetchInit,
        },
    );
}

export function validateEntityAdminAreaManual(payload: {
    kind: EntityAdminAreaKind;
    admin_area_id: string;
    lat?: number;
    lng?: number;
    geometry?: { type: string; coordinates: unknown };
}) {
    return apiFetch<EntityAdminAreaValidateManualResult>("/entity-admin-area/validate-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
}

export type CoreReviewReferenceOptionDto = {
    id: string;
    code: string | null;
    name: string | null;
};

export type CoreReviewReferenceOptionsResponse = {
    ref_poi_categories: CoreReviewReferenceOptionDto[];
    ref_road_classes: CoreReviewReferenceOptionDto[];
    ref_building_types: CoreReviewReferenceOptionDto[];
    ref_land_area_classes?: CoreReviewReferenceOptionDto[];
    ref_admin_levels: CoreReviewReferenceOptionDto[];
    ref_address_component_types: CoreReviewReferenceOptionDto[];
    ref_source_types: CoreReviewReferenceOptionDto[];
    core_admin_areas: CoreReviewReferenceOptionDto[];
};

export function getCoreReviewReferenceOptions(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<CoreReviewReferenceOptionsResponse>("/core-review/reference-options", {
        method: "GET",
        ...fetchInit,
    });
}

export function getAdminReverseAddressDebug(
    lat: number,
    lng: number,
    lang: "en" | "my" = "en",
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<import("@/src/features/addresses/reverseAddress.types").ReverseAddressDebugResponse>(
        "/admin/addresses/reverse-debug",
        { method: "GET", ...fetchInit },
        { lat, lng, lang }
    );
}

export type CoreVerificationStatus =
    | "unverified"
    | "verified"
    | "needs_fix"
    | "questionable"
    | "rejected_after_core_review";

export type CoreVerificationSupport = {
    table_exists: boolean;
    verification_supported: boolean;
    unsupported_reason: string | null;
    missing_verification_columns: string[];
};

export type CoreVerificationSummaryFamily = {
    family: string;
    label: string;
    table: string;
    path: string;
    total: number;
    unverified: number;
    verified: number;
    needs_fix: number;
    questionable: number;
    rejected_after_core_review: number;
    support: CoreVerificationSupport;
};

export type CoreReviewVerificationSummaryFamily = CoreVerificationSummaryFamily & {
    source_label: string | null;
};

export type CoreReviewVerificationSummaryResponse = {
    statuses: CoreVerificationStatus[];
    totals: Record<string, number>;
    families: CoreReviewVerificationSummaryFamily[];
};

export function getCoreReviewVerificationSummary(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<CoreReviewVerificationSummaryResponse>(
        "/core-review/verification-summary",
        { method: "GET", ...fetchInit }
    );
}

export function getRoadClasses(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<RoadClassOption[]>("/road-classes", { method: "GET", ...fetchInit });
}

export function getStreets(params?: StreetsParams, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<Street[]>("/streets", { method: "GET", ...fetchInit }, params);
}

export function getNearbyStreets(params: NearbyStreetsParams, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<NearbyStreet[]>("/streets/nearby", { method: "GET", ...fetchInit }, params);
}

export function getStreet(id: string, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<StreetDetail>(`/streets/${id}`, { method: "GET", ...fetchInit });
}

export function getNearestStreetPoint(
    params: {
        lat: number;
        lng: number;
        radiusMeters: number;
        excludePublicId?: string;
    },
    fetchInit?: Pick<RequestInit, "signal">,
) {
    return apiFetch<NearestStreetPointHit | null>(
        "/streets/nearest-point",
        { method: "GET", ...fetchInit },
        {
            lat: params.lat,
            lng: params.lng,
            radiusMeters: params.radiusMeters,
            ...(params.excludePublicId ? { excludePublicId: params.excludePublicId } : {}),
        },
    );
}

export function validateStreetGeometry(
    payload: {
        geometry: StreetLineStringGeoJson;
        /** `public_id` (UUID) or core `id` (digits / number). */
        streetId?: string | number;
        /** @deprecated Use `streetId`. */
        street_id?: string;
        toleranceMeters?: number;
    },
    init: Pick<RequestInit, "signal"> = {},
) {
    return apiFetch<ValidateStreetGeometryResponse>(
        "/streets/validate-geometry",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            ...init,
        },
    );
}

export function createStreet(payload: CreateStreetPayload) {
    return apiFetch<StreetDetail>("/streets", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function updateStreet(id: string, payload: UpdateStreetPayload) {
    return apiFetch<StreetDetail>(`/streets/${id}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function deleteStreet(id: string, payload?: DeleteStreetPayload) {
    return apiFetch<StreetDetail>(`/streets/${id}`, {
        method: "DELETE",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload ?? {}),
    });
}

export type SplitStreetPayload = {
    point: { lat: number; lng: number };
    editReason?: string;
};

export type SplitStreetResponse = {
    originalStreetId: string;
    newStreets: StreetDetail[];
    /** @deprecated Same as newStreets; kept for backward compatibility. */
    streets?: StreetDetail[];
};

export function splitStreet(id: string, payload: SplitStreetPayload) {
    return apiFetch<SplitStreetResponse>(`/streets/${id}/split`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function getBuildings(params?: BuildingsParams, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<Building[]>("/buildings", { method: "GET", ...fetchInit }, params);
}

export function getBuildingTypes(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<RefBuildingType[]>("/building-types", { method: "GET", ...fetchInit });
}

export function getRefLandAreaClasses(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<RefLandAreaClass[]>("/admin/ref/land-area-classes", { method: "GET", ...fetchInit });
}

export function getRefWaterClasses(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<RefWaterClass[]>("/admin/ref/water-classes", { method: "GET", ...fetchInit });
}

export function getRefBoundaryStatuses(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<RefBoundaryStatus[]>("/admin/ref/boundary-statuses", { method: "GET", ...fetchInit });
}

export function getRefAddressUsageTypes(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<RefAddressUsageType[]>("/admin/ref/address-usage-types", { method: "GET", ...fetchInit });
}

export function getBuilding(id: string, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<Building>(`/buildings/${id}`, { method: "GET", ...fetchInit });
}

export function createBuilding(payload: CreateBuildingPayload) {
    return apiFetch<Building>("/buildings", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function updateBuilding(id: string, payload: UpdateBuildingPayload) {
    return apiFetch<Building>(`/buildings/${id}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function deleteBuilding(id: string) {
    return apiFetch<DeleteBuildingResponse>(`/buildings/${id}`, {
        method: "DELETE",
    });
}

export function getLinkedBuildingsForPlace(placePublicId: string) {
    return apiFetch<LinkedPlaceBuildingListResponse>(`/places/${placePublicId}/buildings`, {
        method: "GET",
    });
}

export function linkBuildingToPlace(placePublicId: string, payload: LinkPlaceBuildingPayload) {
    return apiFetch<LinkPlaceBuildingResponse>(`/places/${placePublicId}/buildings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            building_id: payload.building_id,
            relation_type: payload.relation_type ?? "inside",
            is_primary: payload.is_primary ?? false,
        }),
    });
}

export function unlinkBuildingFromPlace(placePublicId: string, buildingPublicId: string) {
    return apiFetch<{ ok: boolean; place_id: string; building_id: string }>(
        `/places/${placePublicId}/buildings/${buildingPublicId}`,
        { method: "DELETE" }
    );
}

// --- Import review history (read-only) ---

export function getLinkedPlacesForBuilding(buildingPublicId: string) {
    return apiFetch<LinkedPlacesForBuildingResponse>(`/buildings/${buildingPublicId}/places`, {
        method: "GET",
    });
}

export function patchPlaceBuildingLink(
    placePublicId: string,
    buildingPublicId: string,
    payload: PatchPlaceBuildingPayload
) {
    return apiFetch<PatchPlaceBuildingResponse>(
        `/places/${placePublicId}/buildings/${buildingPublicId}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }
    );
}

// --- Core review (paginated list + detail; camelCase DTOs) ---

export type CoreReviewEntitySlug =
    | "buildings"
    | "places"
    | "settlements"
    | "streets"
    | "bus-stops"
    | "bus-routes"
    | "bus-route-variants"
    | "land-areas"
    | "water-lines"
    | "water-polygons"
    | "addresses"
    | "admin-areas";

export type CoreReviewPagination = {
    page: number;
    pageSize: number;
    /** Null when list skipped COUNT(*) (streets progressive loading). */
    total: number | null;
    totalPages: number | null;
};

export type CoreReviewListResponse<T> = {
    data: T[];
    pagination: CoreReviewPagination;
    filters?: Record<string, unknown>;
    meta?: Record<string, unknown>;
};

export type CoreReviewDetailResponse<T> = {
    data: T;
};

export type CoreReviewListStatus = "active" | "deleted" | "all";

/** Query params for GET /core-review/:entity. */
export type CoreReviewListParams = {
    page?: number;
    pageSize?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    verification_status?: Exclude<CoreReviewVerificationStatusFilter, "all">;
    /** @deprecated Legacy boolean alias — use verification_status */
    isVerified?: boolean;
    /** @deprecated Legacy camelCase alias — use verification_status */
    verificationStatus?: Exclude<CoreReviewVerificationStatusFilter, "all">;
    adminAreaId?: string;
    settlementType?: string;
    categoryId?: string;
    buildingTypeId?: string;
    roadClassId?: string;
    isPublic?: boolean;
    /** @deprecated Prefer `status`. When true, maps to `status=all` in list state. */
    includeDeleted?: boolean;
    status?: CoreReviewListStatus;
    routeId?: string;
    landAreaClassId?: string;
    detailLevel?: "zone" | "parcel";
    cropCode?: string;
    boundaryStatus?: string;
    addressUsage?: string;
    isOfficialBoundary?: boolean;
    /** Keyset cursor for streets updated_at sort (page 2+). */
    cursorUpdatedAt?: string;
    cursorId?: string;
    /** When false, list skips COUNT(*) (streets progressive loading). */
    includeTotal?: boolean;
    include_total?: boolean;
};

export type CoreReviewStreetsCountResponse = {
    total: number;
    verificationCounts: {
        total: number;
        verified: number;
        unverified: number;
    };
    filters?: Record<string, unknown>;
};

export function getCoreReviewStreetsCount(
    params?: Omit<CoreReviewListParams, "page" | "pageSize" | "includeTotal" | "include_total">,
    fetchInit?: Pick<RequestInit, "signal">,
) {
    return apiFetch<CoreReviewStreetsCountResponse>(
        "/core-review/streets/count",
        { method: "GET", ...fetchInit },
        params as Record<string, QueryValue> | undefined,
    );
}

export function getCoreReviewList<T = Record<string, unknown>>(
    entity: CoreReviewEntitySlug,
    params?: CoreReviewListParams,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<CoreReviewListResponse<T>>(
        `/core-review/${entity}`,
        { method: "GET", ...fetchInit },
        params as Record<string, QueryValue> | undefined
    );
}

export function getCoreReviewDetail<T = Record<string, unknown>>(
    entity: CoreReviewEntitySlug,
    id: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<CoreReviewDetailResponse<T>>(
        `/core-review/${entity}/${encodeURIComponent(id)}`,
        { method: "GET", ...fetchInit }
    );
}

export type CoreReviewSettlementDuplicateWarning = {
    publicId: string;
    canonicalName: string;
    nameMm: string | null;
    nameEn: string | null;
    settlementTypeCode: string;
    townshipId: string | null;
    townshipName: string | null;
    distanceM: number | null;
    nameSimilarity: number | null;
    sameTownship: boolean;
};

export function getCoreReviewSettlementDuplicateWarnings(
    params: {
        canonicalName?: string;
        nameMm?: string;
        nameEn?: string;
        lat: number;
        lng: number;
        townshipId?: string;
        excludePublicId?: string;
    },
    fetchInit?: Pick<RequestInit, "signal">,
) {
    return apiFetch<{ data: CoreReviewSettlementDuplicateWarning[]; meta?: { warningOnly?: boolean } }>(
        "/core-review/settlements/duplicate-warnings",
        { method: "GET", ...fetchInit },
        params as Record<string, QueryValue>,
    );
}

/** Alias for {@link getCoreReviewList}. */
export const getCoreReviewEntities = getCoreReviewList;

/** Alias for {@link getCoreReviewDetail}. */
export const getCoreReviewEntityById = getCoreReviewDetail;

export function createCoreReviewEntity<T = Record<string, unknown>>(
    entity: CoreReviewEntitySlug,
    body: unknown,
) {
    return apiFetch<CoreReviewDetailResponse<T>>(`/core-review/${entity}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }).then((response) => response.data);
}

export function updateCoreReviewEntity<T = Record<string, unknown>>(
    entity: CoreReviewEntitySlug,
    id: string,
    body: unknown,
) {
    return apiFetch<CoreReviewDetailResponse<T>>(
        `/core-review/${entity}/${encodeURIComponent(id)}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        },
    ).then((response) => response.data);
}

export function softDeleteCoreReviewEntity<T = Record<string, unknown>>(
    entity: CoreReviewEntitySlug,
    id: string,
) {
    return apiFetch<CoreReviewDetailResponse<T>>(
        `/core-review/${entity}/${encodeURIComponent(id)}/soft-delete`,
        { method: "PATCH" },
    ).then((response) => response.data);
}

export function restoreCoreReviewEntity<T = Record<string, unknown>>(
    entity: CoreReviewEntitySlug,
    id: string,
) {
    return apiFetch<CoreReviewDetailResponse<T>>(
        `/core-review/${entity}/${encodeURIComponent(id)}/restore`,
        { method: "PATCH" },
    ).then((response) => response.data);
}
