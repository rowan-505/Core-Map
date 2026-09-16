import type { DevMapEntityType, DevMapFilterPreset } from "./devMapEntityRegistry";
import {
    DEV_MAP_CORE_DATA_ENTITY_TYPES,
    DEV_MAP_ENTITY_REGISTRY,
    DEV_MAP_TRANSPORT_ENTITY_TYPES,
    createDefaultDevMapEnabledEntities,
    getDevMapEntityEntry,
} from "./devMapEntityRegistry";

/** Pure helpers for the horizontal entity filter (no MapLibre calls). */

export function toggleDevMapEntityEnabled(
    enabled: ReadonlySet<DevMapEntityType>,
    entityType: DevMapEntityType,
    nextChecked: boolean,
): Set<DevMapEntityType> {
    const entry = getDevMapEntityEntry(entityType);
    if (!entry.supported) {
        return new Set(enabled);
    }
    const next = new Set(enabled);
    if (nextChecked) {
        next.add(entityType);
    } else {
        next.delete(entityType);
    }
    return next;
}

export function applyDevMapFilterPreset(preset: DevMapFilterPreset): Set<DevMapEntityType> {
    switch (preset) {
        case "clear":
            // Reset to defaults — empty "hide all" left the map looking broken and
            // hard to recover when Martin overlays had failed.
            return createDefaultDevMapEnabledEntities();
        case "all":
            // PMTiles-backed layers only. Places/Transport need Martin; enable those
            // with their checkboxes so a dead tile server does not flood the map.
            return new Set(
                DEV_MAP_ENTITY_REGISTRY.filter(
                    (entry) => entry.supported && entry.sourceKind !== "dynamic",
                ).map((entry) => entry.entityType),
            );
        case "core":
            return new Set(
                DEV_MAP_CORE_DATA_ENTITY_TYPES.filter(
                    (type) => getDevMapEntityEntry(type).supported,
                ),
            );
        case "transport":
            // Keep streets/admin for map context so Transport does not look "empty".
            return new Set(
                [
                    ...DEV_MAP_TRANSPORT_ENTITY_TYPES,
                    "streets" as const,
                    "admin" as const,
                ].filter((type) => getDevMapEntityEntry(type).supported),
            );
        default: {
            const _exhaustive: never = preset;
            return _exhaustive;
        }
    }
}

/** True when exactly one supported entity is enabled (others off). */
export function isSingleEntityFilter(enabled: ReadonlySet<DevMapEntityType>): boolean {
    const supportedEnabled = [...enabled].filter((type) => getDevMapEntityEntry(type).supported);
    return supportedEnabled.length === 1;
}
