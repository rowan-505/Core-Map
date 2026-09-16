import type { StyleSpecification } from "maplibre-gl";
import { createOverviewStyle } from "@local-map/map-style/overviewSource";
import { OVERVIEW_VECTOR_SOURCE_ID } from "@local-map/map-style/overviewConstants";

import { applyDashboardLocalGlyphs } from "@/src/lib/map/dashboardMapFonts";
import { loadDashboardBasemapManifest } from "@/src/lib/basemaps/manifest";

/** Public overview style name from packages/map-style/overview-map.json. */
export const DEV_MAP_PUBLIC_OVERVIEW_STYLE_NAME = "CoreMap Myanmar Overview";

/**
 * Builds the Dev Map initial style from the **public** overview PMTiles style
 * (`createOverviewStyle` → overview-map.json), not dashboard-overview-map.json.
 * Glyphs are remapped to the dashboard local font endpoint only.
 */
export async function fetchDevMapPublicOverviewStyle(options?: {
    signal?: AbortSignal;
}): Promise<StyleSpecification> {
    const manifest = await loadDashboardBasemapManifest(options?.signal);
    const overviewStyle = createOverviewStyle(manifest.overview.url) as StyleSpecification;
    return applyDashboardLocalGlyphs(overviewStyle);
}

export function assertDevMapUsesPublicOverviewStyle(style: StyleSpecification): void {
    if (style.name !== DEV_MAP_PUBLIC_OVERVIEW_STYLE_NAME) {
        throw new Error(
            `Dev Map must use public overview style "${DEV_MAP_PUBLIC_OVERVIEW_STYLE_NAME}", got "${style.name ?? ""}"`,
        );
    }
    if (!style.sources?.[OVERVIEW_VECTOR_SOURCE_ID]) {
        throw new Error(`Dev Map overview style missing source "${OVERVIEW_VECTOR_SOURCE_ID}"`);
    }
}
