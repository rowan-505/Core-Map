/**
 * Local Windows/WSL hybrid basemap admin bridge.
 *
 * Hard-disabled in production. Enabled only when explicitly opted in and a
 * local tile database URL is present. Never exposes credentials to clients.
 */
export function isLocalBasemapAdminEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    if (env.NODE_ENV === "production") {
        return false;
    }
    const flag = (env.ENABLE_LOCAL_BASEMAP_ADMIN ?? "").trim().toLowerCase();
    if (flag !== "true" && flag !== "1") {
        return false;
    }
    const tileUrl = (env.LOCAL_TILE_DATABASE_URL || env.COREMAP_TILES_DATABASE_URL || "").trim();
    return tileUrl.length > 0;
}

export function localBasemapDisabledReason(env: NodeJS.ProcessEnv = process.env): string {
    if (env.NODE_ENV === "production") {
        return "Local Basemap admin is unavailable in production.";
    }
    const flag = (env.ENABLE_LOCAL_BASEMAP_ADMIN ?? "").trim().toLowerCase();
    if (flag !== "true" && flag !== "1") {
        return "Set ENABLE_LOCAL_BASEMAP_ADMIN=true to enable Local Basemap admin.";
    }
    if (!(env.LOCAL_TILE_DATABASE_URL || env.COREMAP_TILES_DATABASE_URL || "").trim()) {
        return "LOCAL_TILE_DATABASE_URL is required for Local Basemap admin.";
    }
    return "Local Basemap admin is disabled.";
}
