import type { Map as MaplibreMap } from "maplibre-gl";

import {
    noteDevMapMartinFetchFailure,
    stripDevMapDynamicOverlays,
} from "@/src/features/dev-map/devMapDynamicOverlays";
import { recoverDevMapLifecycleAuth } from "@/src/features/dev-map/devMapLifecycleOverlay";

function stringifyError(err: unknown): string {
    if (err instanceof Error) {
        return err.message;
    }

    return String(err ?? "");
}

/**
 * Martin tile endpoints that can fail (e.g. 500 / DNS / CORS) without breaking map UX.
 * Downgrade to dev-only warnings so Dev Map / editors are not noisy in the console.
 */
function isOptionalMartinTileFailureMessage(message: string): boolean {
    const m = message.toLowerCase();
    return (
        m.includes("transport_stops_v") ||
        m.includes("transport_route_paths_v") ||
        m.includes("tiles_places_v") ||
        m.includes("/transport_stops") ||
        m.includes("/transport_route_paths") ||
        m.includes("martin-lively-canyon") ||
        m.includes("martin")
    );
}

function isLifecycleTileFailure(message: string, status?: number): boolean {
    const m = message.toLowerCase();
    const isLifecycle =
        m.includes("/local-basemap/tiles/") ||
        m.includes("land_lifecycle") ||
        m.includes("buildings_lifecycle");
    if (!isLifecycle) return false;
    return (
        status === 401 ||
        status === 0 ||
        m.includes("unauthorized") ||
        m.includes("401") ||
        m.includes("token expired") ||
        m.includes("failed to fetch") ||
        m.includes("networkerror") ||
        m.includes("load failed")
    );
}

function isLifecycleTileAuthFailure(message: string, status?: number): boolean {
    const m = message.toLowerCase();
    return (
        status === 401 ||
        m.includes("unauthorized") ||
        m.includes("401") ||
        m.includes("token expired")
    );
}

function isTransientMapNetworkFailure(message: string, status?: number): boolean {
    const m = message.toLowerCase();
    return (
        status === 0 ||
        m.includes("failed to fetch") ||
        m.includes("networkerror") ||
        m.includes("load failed") ||
        m.includes("network request failed")
    );
}

export function attachDashboardMapErrorHandler(map: MaplibreMap, context: string): void {
    map.on("error", (event: { error?: unknown }) => {
        const msg = stringifyError(event.error);
        const errObj =
            event.error && typeof event.error === "object"
                ? (event.error as { url?: unknown; status?: unknown })
                : null;
        const url = typeof errObj?.url === "string" ? errObj.url : "";
        const status = typeof errObj?.status === "number" ? errObj.status : undefined;
        const combined = `${msg} ${url}`;

        if (isLifecycleTileFailure(combined, status)) {
            if (isLifecycleTileAuthFailure(combined, status)) {
                recoverDevMapLifecycleAuth(map);
            }
            if (process.env.NODE_ENV === "development") {
                console.warn(
                    `[${context}] lifecycle tile warning (non-fatal):`,
                    event.error ?? event,
                );
            }
            return;
        }

        // Dev Map: bare "Failed to fetch" (no URL) happens when API restarts mid-tile storm.
        if (
            context === "createDevMapBasemap" &&
            isTransientMapNetworkFailure(combined, status)
        ) {
            if (process.env.NODE_ENV === "development") {
                console.warn(`[${context}] map network warning (non-fatal):`, event.error ?? event);
            }
            return;
        }

        if (isOptionalMartinTileFailureMessage(combined)) {
            noteDevMapMartinFetchFailure(combined);
            try {
                stripDevMapDynamicOverlays(map);
            } catch {
                /* ignore */
            }
            if (process.env.NODE_ENV === "development") {
                console.warn(`[${context}] map tile warning (non-fatal):`, event.error ?? event);
            }

            return;
        }

        console.error(`${context} map error:`, event.error ?? event);
    });
}
