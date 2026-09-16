import type { Map as MaplibreMap } from "maplibre-gl";

import type { DevMapEntityType } from "./devMapEntityRegistry";
import {
    DEV_MAP_ENTITY_REGISTRY,
    createDefaultDevMapEnabledEntities,
    isDevMapLayerIdForEntity,
} from "./devMapEntityRegistry";
import { applyDevMapLifecycleOverlayVisibility } from "./devMapLifecycleOverlay";
import { applyDevMapDynamicOverlayVisibility } from "./devMapDynamicOverlays";

type VisibilityMap = MaplibreMap;

const enabledByMap = new WeakMap<VisibilityMap, ReadonlySet<DevMapEntityType>>();

function layerBelongsToAnyRegisteredEntity(layerId: string): boolean {
    return DEV_MAP_ENTITY_REGISTRY.some(
        (entry) => entry.supported && isDevMapLayerIdForEntity(layerId, entry),
    );
}

/**
 * Sets visibility on existing MapLibre layers only — does not reload style.
 * Regional clones (`buildings-yangon`) match via base layer id prefix.
 * Lifecycle + dynamic overlays: create when enabled, remove when disabled
 * (stops tile fetch for off entities without remounting the map).
 */
export function applyDevMapEntityVisibility(
    map: VisibilityMap,
    enabled: ReadonlySet<DevMapEntityType>,
): void {
    enabledByMap.set(map, enabled);

    // Do not bail on !isStyleLoaded() — Clear→Core must still restore layer visibility
    // after Martin tile storms leave the style mid-update.

    let styleLayers: { id: string }[] = [];
    try {
        styleLayers = (map.getStyle()?.layers ?? []) as { id: string }[];
    } catch {
        styleLayers = [];
    }

    for (const layer of styleLayers) {
        if (!layerBelongsToAnyRegisteredEntity(layer.id)) {
            continue;
        }
        if (!map.getLayer(layer.id)) {
            continue;
        }

        const owning = DEV_MAP_ENTITY_REGISTRY.find(
            (entry) => entry.supported && isDevMapLayerIdForEntity(layer.id, entry),
        );
        if (!owning) {
            continue;
        }

        const visible = enabled.has(owning.entityType);
        try {
            map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
        } catch {
            // Layer may not accept layout updates mid-style mutation.
        }
    }

    try {
        applyDevMapLifecycleOverlayVisibility(map, enabled);
    } catch (error) {
        if (process.env.NODE_ENV !== "production") {
            console.warn("[dev-map] lifecycle visibility failed:", error);
        }
    }

    try {
        applyDevMapDynamicOverlayVisibility(map, enabled);
    } catch (error) {
        if (process.env.NODE_ENV !== "production") {
            console.warn("[dev-map] dynamic visibility failed:", error);
        }
    }

    try {
        map.triggerRepaint();
    } catch {
        /* ignore */
    }
}

export function getDevMapEnabledEntitiesForMap(
    map: VisibilityMap,
): ReadonlySet<DevMapEntityType> {
    return enabledByMap.get(map) ?? createDefaultDevMapEnabledEntities();
}

/** Call after regional layers are added so new clones pick up the current filter. */
export function reapplyDevMapEntityVisibility(map: VisibilityMap): void {
    applyDevMapEntityVisibility(map, getDevMapEnabledEntitiesForMap(map));
}
