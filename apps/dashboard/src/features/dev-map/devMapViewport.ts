import { PUBLIC_MAP_MAX_ZOOM } from "@local-map/map-style/regionalZoomPolicy";

/**
 * Myanmar overview camera defaults aligned with the public web map.
 * Kept here (not imported from apps/web) so the dashboard does not couple to the Vite map shell.
 */

/** Target bounds for startup fitBounds (Myanmar + neighbors). */
export const DEV_MAP_OVERVIEW_FIT_BOUNDS: readonly [[number, number], [number, number]] = [
    [80.0, 5.0],
    [110.0, 32.0],
];

export const DEV_MAP_FALLBACK_CENTER: [number, number] = [96.0, 19.5];
export const DEV_MAP_FALLBACK_ZOOM = 4.0;
export const DEV_MAP_MIN_ZOOM = 2.0;
export const DEV_MAP_MAX_ZOOM = PUBLIC_MAP_MAX_ZOOM;

export const DEV_MAP_STARTUP_FIT_PADDING = {
    top: 56,
    right: 72,
    bottom: 48,
    left: 72,
} as const;
