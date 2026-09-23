import { fetchActiveBasemapPmtilesHttpUrl } from "@local-map/map-style/basemapSource";
import { fetchActiveOverviewPmtilesHttpUrl } from "@local-map/map-style/overviewSource";
import {
    getDashboardBasemapCurrentJsonUrl,
    getDashboardOverviewCurrentJsonUrl,
} from "@/src/lib/dashboardBasemapCurrentJsonUrl";
import {
    assertPublicBasemapUrl,
} from "@/src/lib/basemaps/basemapEnv";

import "./env";

// Re-exported from the centralized basemap env module so existing importers keep working.
export {
    DASHBOARD_BASEMAP_NOT_CONFIGURED_MESSAGE,
    DashboardBasemapNotConfiguredError,
} from "@/src/lib/basemaps/basemapEnv";

const IS_DEV = process.env.NODE_ENV !== "production";

/** Public CDN regional basemap (Yangon) — default when no env override is set. */
export const DEFAULT_CDN_BASEMAP_PMTILES_URL =
    "https://tiles.coremapmm.com/basemaps/yangon/v2/basemap.pmtiles";

/** Public CDN overview basemap — default when no env override is set. */
export const DEFAULT_CDN_OVERVIEW_PMTILES_URL =
    "https://tiles.coremapmm.com/basemaps/overview/v2/myanmar-overview-v2.pmtiles";

/** CDN base for regional archives: `{base}/{region}/v2/basemap.pmtiles`. */
const DEFAULT_CDN_REGION_PMTILES_BASE_URL = "https://tiles.coremapmm.com/basemaps";

/**
 * Optional direct PMTiles archive URL from the Next.js client bundle.
 * When set, dashboard maps skip `current.json` and use this URL for the `local-basemap` vector source.
 *
 * MapLibre still needs `ensurePmtilesProtocol` from `@local-map/map-style/registerPmtilesProtocol`
 * once per map boot — it is idempotent and safe across React rerenders.
 */
export function getDashboardBasemapPmtilesUrlOverride(): string | undefined {
    const v = process.env.NEXT_PUBLIC_BASEMAP_PMTILES_URL;
    if (typeof v === "string" && v.trim() !== "") {
        // Reject a localhost URL in production (allowed in local dev); never fetch localhost when deployed.
        return assertPublicBasemapUrl(v.trim(), "NEXT_PUBLIC_BASEMAP_PMTILES_URL");
    }
    return undefined;
}

/**
 * Resolves the HTTP(S) URL of the active `.pmtiles` file: env override, else `current.json`,
 * else the public CoreMap CDN Yangon archive (so maps work without a local tile server).
 */
export async function resolveDashboardBasemapPmtilesHttpUrl(options?: {
    signal?: AbortSignal;
    currentJsonUrl?: string;
}): Promise<string> {
    const override = getDashboardBasemapPmtilesUrlOverride();
    if (override) {
        return override;
    }
    const currentJsonUrl = options?.currentJsonUrl ?? getDashboardBasemapCurrentJsonUrl();
    if (currentJsonUrl) {
        try {
            return await fetchActiveBasemapPmtilesHttpUrl({
                currentJsonUrl,
                signal: options?.signal,
            });
        } catch (err) {
            // Local `current.json` (e.g. localhost:8080) is often offline — fall through to CDN.
            if (IS_DEV) {
                console.warn(
                    "[dashboard] basemap current.json failed; using tiles.coremapmm.com",
                    err,
                );
            }
        }
    }
    return DEFAULT_CDN_BASEMAP_PMTILES_URL;
}

/**
 * Optional direct overview `.pmtiles` HTTP(S) URL (`NEXT_PUBLIC_OVERVIEW_PMTILES_URL`).
 * The overview archive provides whole-country context (z0–z8) layered under the regional basemap.
 */
export function getDashboardOverviewPmtilesUrlOverride(): string | undefined {
    const v = process.env.NEXT_PUBLIC_OVERVIEW_PMTILES_URL;
    if (typeof v === "string" && v.trim() !== "") {
        // Reject a localhost URL in production (allowed in local dev); never fetch localhost when deployed.
        return assertPublicBasemapUrl(v.trim(), "NEXT_PUBLIC_OVERVIEW_PMTILES_URL");
    }
    return undefined;
}

/**
 * Resolves the active overview `.pmtiles` HTTP(S) URL: env override, else overview `current.json`,
 * else the public CoreMap CDN overview archive.
 */
export async function resolveDashboardOverviewPmtilesHttpUrl(options?: {
    signal?: AbortSignal;
    currentJsonUrl?: string;
}): Promise<string> {
    const override = getDashboardOverviewPmtilesUrlOverride();
    if (override) {
        return override;
    }
    const currentJsonUrl = options?.currentJsonUrl ?? getDashboardOverviewCurrentJsonUrl();
    if (currentJsonUrl) {
        try {
            return await fetchActiveOverviewPmtilesHttpUrl({
                currentJsonUrl,
                signal: options?.signal,
            });
        } catch (err) {
            if (IS_DEV) {
                console.warn(
                    "[dashboard] overview current.json failed; using tiles.coremapmm.com",
                    err,
                );
            }
        }
    }
    return DEFAULT_CDN_OVERVIEW_PMTILES_URL;
}

/**
 * DEV-ONLY: when `NEXT_PUBLIC_LOAD_ALL_LOCAL_REGION_PMTILES` is truthy, preview maps load every
 * regional archive for full nationwide detail. Ignored in production.
 */
export function isDashboardLoadAllRegionPmtilesEnabled(): boolean {
    if (!IS_DEV) {
        return false;
    }
    const v = process.env.NEXT_PUBLIC_LOAD_ALL_LOCAL_REGION_PMTILES;
    if (typeof v !== "string") {
        return false;
    }
    const normalized = v.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
}

/** Base URL for regional `.pmtiles` archives (CDN by default). */
export function getDashboardLocalRegionPmtilesBaseUrl(): string {
    const v = process.env.NEXT_PUBLIC_LOCAL_REGION_PMTILES_BASE_URL;
    if (typeof v === "string" && v.trim() !== "") {
        const trimmed = v.trim().replace(/\/+$/, "");
        // Allow host-only values from older .env files.
        if (/^https?:\/\//i.test(trimmed)) {
            return trimmed;
        }
        return `https://${trimmed.replace(/^\/+/, "")}`;
    }
    return DEFAULT_CDN_REGION_PMTILES_BASE_URL;
}
