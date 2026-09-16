import type { Geometry } from "geojson";

import type { DevMapEntityType } from "./devMapEntityRegistry";

/**
 * Normalized Dev Map selection — identity + highlight geometry only.
 * Full entity payloads stay on detail APIs / pages.
 */
export type DevMapSelection = {
    entityType: DevMapEntityType;
    /** Primary identity string for UI / deep links (feature_key, core_id, or public id). */
    entityId: string;
    featureKey: string | null;
    coreId: string | null;
    corePublicId: string | null;
    displayName: string;
    sourceLayer: string;
    layerId: string;
    geometry: Geometry;
    detailRoute: string | null;
    detailApi: string | null;
};

export function resolveDevMapDetailHref(selection: DevMapSelection): string | null {
    if (!selection.detailRoute) {
        return null;
    }
    const id =
        selection.corePublicId ??
        (selection.entityType === "buildings" || selection.entityType === "land"
            ? selection.featureKey
            : null) ??
        (selection.entityType === "transport_stops" ||
        selection.entityType === "transport_routes" ||
        selection.entityType === "places"
            ? selection.entityId
            : null) ??
        selection.entityId;
    if (!id) {
        return null;
    }
    return selection.detailRoute
        .replace("[id]", encodeURIComponent(id))
        .replace("[publicId]", encodeURIComponent(id));
}
