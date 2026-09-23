/**
 * `current.json` URL for dashboard basemap resolution (client bundle inlines `NEXT_PUBLIC_*`).
 *
 * Prefer `NEXT_PUBLIC_BASEMAP_PMTILES_URL` (CDN) for editor maps. When unset, `config/map.ts`
 * falls back to `https://tiles.coremapmm.com/...` and does not require a local tile server.
 *
 * Optional `NEXT_PUBLIC_BASEMAP_CURRENT_JSON_URL` still works for a custom pointer file.
 * The old localhost:8080 default is no longer used — it caused connection-refused errors
 * whenever `tiles:serve` was not running.
 */
export function getDashboardBasemapCurrentJsonUrl(): string | undefined {
    const v = process.env.NEXT_PUBLIC_BASEMAP_CURRENT_JSON_URL;
    if (typeof v === "string" && v.trim() !== "") {
        return v.trim();
    }
    return undefined;
}

/**
 * Overview (z0–z8 whole-country) `current.json` URL for dashboard preview maps.
 *
 * Same CDN-first policy as {@link getDashboardBasemapCurrentJsonUrl}.
 */
export function getDashboardOverviewCurrentJsonUrl(): string | undefined {
    const v = process.env.NEXT_PUBLIC_OVERVIEW_CURRENT_JSON_URL;
    if (typeof v === "string" && v.trim() !== "") {
        return v.trim();
    }
    return undefined;
}
