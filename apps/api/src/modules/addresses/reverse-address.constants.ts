/** Max distance (m) for exact core address match (point or entrance). */
export const REVERSE_EXACT_ADDRESS_MAX_M = 30;

/** Prefer streets within this distance (m) for high-confidence street match. */
export const REVERSE_STREET_CLOSE_M = 100;

/** Max distance (m) for street-area fallback. */
export const REVERSE_STREET_MAX_M = 300;

/** Max distance (m) for nearby place POI. */
export const REVERSE_PLACE_MAX_M = 150;

/** Max distance (m) for nearest village locality hint (centroid). */
export const REVERSE_VILLAGE_HINT_MAX_M = 3000;

export const REVERSE_CANDIDATE_LIMIT = 8;

/**
 * Degree expand for GiST `geom && ST_Expand(...)` prefilters (same idea as
 * migration 109 / `core.reverse_address_minimal`). Coarse only — exact filter
 * remains `ST_DWithin(...::geography, meters)`.
 */
export const REVERSE_ADDRESS_EXPAND_DEG = 0.0005; // ~30m+
export const REVERSE_PLACE_EXPAND_DEG = 0.002; // ~150m+
export const REVERSE_STREET_EXPAND_DEG = 0.004; // ~300m+
export const REVERSE_VILLAGE_EXPAND_DEG = 0.03; // ~3000m+

/** Max concurrent DB-heavy reverse layer queries per request. */
export const REVERSE_LAYER_CONCURRENCY = 2;

export const OFFICIAL_BOUNDARY_STATUSES = new Set(["official", "surveyed"]);

export const LOCALITY_HINT_BOUNDARY_STATUSES = new Set(["approximate", "settlement_extent"]);

export function isLocalityHintAdmin(boundaryStatus: string | null, addressUsage: string | null): boolean {
    const usage = (addressUsage ?? "").trim().toLowerCase();
    const status = (boundaryStatus ?? "").trim().toLowerCase();
    return (
        usage === "locality_hint" &&
        (LOCALITY_HINT_BOUNDARY_STATUSES.has(status) || status === "approximate" || status === "settlement_extent")
    );
}

export function isOfficialAdmin(boundaryStatus: string | null, addressUsage: string | null): boolean {
    const usage = (addressUsage ?? "").trim().toLowerCase();
    const status = (boundaryStatus ?? "").trim().toLowerCase();
    if (usage === "locality_hint" || usage === "search_only" || usage === "disabled") {
        return false;
    }
    if (LOCALITY_HINT_BOUNDARY_STATUSES.has(status)) {
        return false;
    }
    return usage === "official" && OFFICIAL_BOUNDARY_STATUSES.has(status);
}
