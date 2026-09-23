/**
 * Dashboard admin-area MVT helpers.
 * Reuses the same ST_AsMVT / tile-envelope pattern as local-basemap lifecycle tiles.
 * Geometry is simplified by zoom; full-resolution polygons are never packed into tiles.
 */

export const ADMIN_AREAS_MVT_LAYER = "admin_areas";
export const ADMIN_AREAS_MVT_FEATURE_LIMIT = 800;
export const ADMIN_AREAS_MVT_STATEMENT_TIMEOUT_MS = 4_000;
/** No nationwide polygons at very low zooms (overview PMTiles cover that). */
export const ADMIN_AREAS_MVT_MIN_ZOOM = 5;

export function isValidAdminAreaTileCoord(z: number, x: number, y: number): boolean {
    if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
        return false;
    }
    if (z < 0 || z > 22) {
        return false;
    }
    const max = 2 ** z;
    return x >= 0 && y >= 0 && x < max && y < max;
}

/**
 * Tolerance in degrees for ST_SimplifyPreserveTopology.
 * Higher zoom → less simplify. Returns 0 to skip simplify (still clipped by MVT).
 */
export function simplifyToleranceDegrees(z: number): number {
    if (z <= 6) {
        return 0.05;
    }
    if (z <= 8) {
        return 0.02;
    }
    if (z <= 10) {
        return 0.008;
    }
    if (z <= 12) {
        return 0.003;
    }
    if (z <= 14) {
        return 0.001;
    }
    return 0;
}

export function shouldServeAdminAreaTile(z: number): boolean {
    return z >= ADMIN_AREAS_MVT_MIN_ZOOM;
}
