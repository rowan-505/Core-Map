export const EXISTING_STOP_SEARCH_FOCUS_ZOOM = 16;

export type ExistingStopSearchPreviewPoint = {
    readonly publicId: string;
    readonly lng: number;
    readonly lat: number;
};

export type CameraPadding = {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
};

export type RectLike = {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly width: number;
    readonly height: number;
};

type SearchCoordItem = {
    readonly public_id: string;
    readonly lon: number | null;
    readonly lat: number | null;
};

const EDGE_PX = 1;
const GAP_PX = 24;
const MIN_VISIBLE_MAP_PX = 80;

/** True when lng/lat are finite WGS84 numbers that MapLibre can render. */
export function isFiniteLngLat(lng: unknown, lat: unknown): boolean {
    return (
        typeof lng === "number" &&
        typeof lat === "number" &&
        Number.isFinite(lng) &&
        Number.isFinite(lat)
    );
}

export function finiteLngLat(
    lng: unknown,
    lat: unknown,
): { lng: number; lat: number } | null {
    if (!isFiniteLngLat(lng, lat)) {
        return null;
    }
    return { lng: lng as number, lat: lat as number };
}

/**
 * Map visible search hits to preview points. Skips rows without finite coordinates.
 */
export function existingStopSearchPreviewPoints(
    items: readonly SearchCoordItem[],
): ExistingStopSearchPreviewPoint[] {
    const points: ExistingStopSearchPreviewPoint[] = [];
    for (const item of items) {
        const point = finiteLngLat(item.lon, item.lat);
        if (!point) {
            continue;
        }
        points.push({ publicId: item.public_id, lng: point.lng, lat: point.lat });
    }
    return points;
}

/** Keep the current zoom when it is already closer than the focus zoom. */
export function candidateFocusZoom(
    currentZoom: number,
    minZoom = EXISTING_STOP_SEARCH_FOCUS_ZOOM,
): number {
    if (!Number.isFinite(currentZoom)) {
        return minZoom;
    }
    return Math.max(currentZoom, minZoom);
}

function clampPadding(value: number, max: number): number {
    return Math.max(GAP_PX, Math.min(value, max));
}

/**
 * Padding so easeTo keeps the selected marker in the map area not covered by the
 * existing-stop overlay/drawer.
 */
export function cameraPaddingForOverlay(mapRect: RectLike, overlayRect: RectLike): CameraPadding {
    const maxHorizontal = Math.max(GAP_PX, mapRect.width - MIN_VISIBLE_MAP_PX);
    const maxVertical = Math.max(GAP_PX, mapRect.height - MIN_VISIBLE_MAP_PX);

    const intersects =
        overlayRect.left < mapRect.right &&
        overlayRect.right > mapRect.left &&
        overlayRect.top < mapRect.bottom &&
        overlayRect.bottom > mapRect.top;

    if (!intersects) {
        return { top: GAP_PX, right: GAP_PX, bottom: GAP_PX, left: GAP_PX };
    }

    let left = GAP_PX;
    let right = GAP_PX;
    let top = GAP_PX;
    let bottom = GAP_PX;

    const coversLeft = overlayRect.left <= mapRect.left + EDGE_PX;
    const coversRight = overlayRect.right >= mapRect.right - EDGE_PX;
    const coversTop = overlayRect.top <= mapRect.top + EDGE_PX;
    const coversBottom = overlayRect.bottom >= mapRect.bottom - EDGE_PX;

    if (coversLeft && overlayRect.right < mapRect.right - MIN_VISIBLE_MAP_PX) {
        left = clampPadding(overlayRect.right - mapRect.left + GAP_PX, maxHorizontal);
    }
    if (coversRight && overlayRect.left > mapRect.left + MIN_VISIBLE_MAP_PX) {
        right = clampPadding(mapRect.right - overlayRect.left + GAP_PX, maxHorizontal);
    }
    if (coversTop && overlayRect.bottom < mapRect.bottom - MIN_VISIBLE_MAP_PX) {
        top = clampPadding(overlayRect.bottom - mapRect.top + GAP_PX, maxVertical);
    }
    if (coversBottom && overlayRect.top > mapRect.top + MIN_VISIBLE_MAP_PX) {
        bottom = clampPadding(mapRect.bottom - overlayRect.top + GAP_PX, maxVertical);
    }

    return { top, right, bottom, left };
}
