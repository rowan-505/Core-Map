import type { Geometry } from "geojson";
import type { MapGeoJSONFeature } from "maplibre-gl";

import type { DevMapEntityEntry, DevMapEntityType } from "./devMapEntityRegistry";
import {
    DEV_MAP_ENTITY_REGISTRY,
    getDevMapEntityEntry,
    getSelectableDevMapEntityTypes,
    isDevMapLayerIdForEntity,
} from "./devMapEntityRegistry";
import {
    DEV_MAP_LIFECYCLE_MIN_ZOOM,
    DEV_MAP_LIFECYCLE_SELECTION_PRIORITY,
    lifecycleEntityForLayerId,
    listDevMapLifecycleLayerIdsForEntity,
} from "./devMapLifecycleOverlay";
import { listDevMapDynamicLayerIdsForEntity } from "./devMapDynamicOverlays";
import type { DevMapSelection } from "./devMapSelection";

export type DevMapClickPoint = { x: number; y: number };

/** Structural map surface used by click selection (avoids MapLibre PointLike coupling). */
export type DevMapClickMap = {
    getZoom(): number;
    getLayer(id: string): unknown;
    getStyle(): { layers?: { id: string }[] } | undefined;
    getLayoutProperty?(layerId: string, name: string): unknown;
    queryRenderedFeatures(
        point: unknown,
        options?: { layers?: string[] },
    ): MapGeoJSONFeature[];
};

export type DevMapClickCandidate = {
    entityType: DevMapEntityType;
    selectionPriority: number;
    feature: MapGeoJSONFeature;
    layerId: string;
    sourceLayer: string;
    entityId: string;
    featureKey: string | null;
    coreId: string | null;
    corePublicId: string | null;
    displayName: string;
};

function readProp(props: Record<string, unknown> | null | undefined, key: string): string | null {
    if (!props) return null;
    const value = props[key];
    if (value == null) return null;
    const text = String(value).trim();
    return text.length > 0 ? text : null;
}

function displayNameFromProps(props: Record<string, unknown> | null | undefined): string {
    return (
        readProp(props, "name") ??
        readProp(props, "name_en") ??
        readProp(props, "name_mm") ??
        readProp(props, "canonical_name") ??
        readProp(props, "public_name") ??
        readProp(props, "primary_name") ??
        readProp(props, "route_code") ??
        "Unnamed"
    );
}

/**
 * Collect MapLibre layer ids that belong to currently selectable (enabled + supported)
 * entity types and are present on the style.
 * Lifecycle overlay layers are included first so hit-testing prefers live features.
 * Skips layers with layout visibility "none" when MapLibre exposes getLayoutProperty.
 */
export function listQueryableDevMapLayerIds(
    map: Pick<DevMapClickMap, "getLayer" | "getStyle" | "getZoom" | "getLayoutProperty">,
    enabled: ReadonlySet<DevMapEntityType>,
): string[] {
    const zoom = map.getZoom();
    const selectable = new Set(
        getSelectableDevMapEntityTypes(enabled).filter((type) => {
            const entry = getDevMapEntityEntry(type);
            return zoom >= entry.minSelectableZoom;
        }),
    );

    let styleLayers: { id: string }[] = [];
    try {
        styleLayers = map.getStyle()?.layers ?? [];
    } catch {
        return [];
    }

    const isQueryableLayer = (layerId: string): boolean => {
        if (!map.getLayer(layerId)) return false;
        if (typeof map.getLayoutProperty !== "function") return true;
        try {
            return map.getLayoutProperty(layerId, "visibility") !== "none";
        } catch {
            return true;
        }
    };

    const ids: string[] = [];
    const seen = new Set<string>();
    const styleLayerIds = new Set(styleLayers.map((layer) => layer.id));

    // Prefer high-value dynamic points, then lifecycle overlays, then static PMTiles.
    const preferFirst: DevMapEntityType[] = [
        "places",
        "transport_stops",
        "buildings",
        "land",
        "transport_routes",
    ];
    for (const entityType of preferFirst) {
        if (!selectable.has(entityType)) continue;
        for (const layerId of listDevMapDynamicLayerIdsForEntity(entityType)) {
            if (!styleLayerIds.has(layerId) || !isQueryableLayer(layerId) || seen.has(layerId)) {
                continue;
            }
            seen.add(layerId);
            ids.push(layerId);
        }
        for (const layerId of listDevMapLifecycleLayerIdsForEntity(entityType)) {
            if (!styleLayerIds.has(layerId)) continue;
            if (!isQueryableLayer(layerId)) continue;
            if (entityType === "buildings" && zoom < DEV_MAP_LIFECYCLE_MIN_ZOOM.buildings) {
                continue;
            }
            if (entityType === "land" && zoom < DEV_MAP_LIFECYCLE_MIN_ZOOM.land) {
                continue;
            }
            if (seen.has(layerId)) continue;
            seen.add(layerId);
            ids.push(layerId);
        }
    }

    for (const layer of styleLayers) {
        if (seen.has(layer.id)) continue;
        if (!isQueryableLayer(layer.id)) continue;
        for (const entry of DEV_MAP_ENTITY_REGISTRY) {
            if (!selectable.has(entry.entityType)) continue;
            if (!isDevMapLayerIdForEntity(layer.id, entry)) continue;
            seen.add(layer.id);
            ids.push(layer.id);
            break;
        }
    }
    return ids;
}

export function resolveEntityEntryForLayerId(layerId: string): DevMapEntityEntry | null {
    const lifecycleEntity = lifecycleEntityForLayerId(layerId);
    if (lifecycleEntity) {
        return getDevMapEntityEntry(lifecycleEntity);
    }
    for (const entry of DEV_MAP_ENTITY_REGISTRY) {
        if (!entry.supported) continue;
        if (isDevMapLayerIdForEntity(layerId, entry)) {
            return entry;
        }
    }
    return null;
}

/**
 * Extract stable identity from a rendered MVT feature.
 * Returns null when no usable id is present (feature is not selectable).
 */
export function normalizeDevMapFeatureIdentity(
    entry: DevMapEntityEntry,
    feature: MapGeoJSONFeature,
): Omit<
    DevMapClickCandidate,
    "entityType" | "selectionPriority" | "feature" | "layerId" | "sourceLayer"
> | null {
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const featureKey = readProp(props, "feature_key");
    const coreId =
        readProp(props, "core_id") ??
        readProp(props, "coreId") ??
        (entry.stableIdProperty === "core_id" ? readProp(props, "id") : null);
    const corePublicId =
        readProp(props, "core_public_id") ??
        readProp(props, "corePublicId") ??
        readProp(props, "public_id") ??
        readProp(props, "publicId");

    let entityId: string | null = null;
    if (entry.entityType === "transport_routes") {
        // API detail accepts route_code or public_id; tiles expose route_code + route_id.
        entityId =
            readProp(props, "route_code") ??
            readProp(props, "public_id") ??
            readProp(props, "route_id") ??
            featureKey;
    } else if (entry.stableIdProperty === "feature_key") {
        entityId = featureKey;
    } else if (entry.stableIdProperty === "core_id") {
        // Detail APIs prefer public UUID; PMTiles often ship both core_id + core_public_id.
        entityId = corePublicId ?? coreId;
    } else if (entry.stableIdProperty === "core_public_id") {
        entityId = corePublicId ?? coreId;
    } else if (entry.stableIdProperty === "public_id") {
        entityId = corePublicId ?? readProp(props, "public_id") ?? readProp(props, "id");
    } else if (entry.stableIdProperty) {
        entityId = readProp(props, entry.stableIdProperty);
    }

    // Fallbacks when primary property is missing but another stable id exists.
    entityId = entityId ?? corePublicId ?? featureKey ?? coreId;
    if (!entityId) {
        return null;
    }

    return {
        entityId,
        featureKey,
        coreId,
        corePublicId:
            corePublicId ??
            (entry.entityType === "places" || entry.entityType === "transport_stops"
                ? entityId
                : looksLikeUuid(entityId)
                  ? entityId
                  : null),
        displayName: displayNameFromProps(props),
    };
}

function looksLikeUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export function candidateFromFeature(
    feature: MapGeoJSONFeature,
    enabled: ReadonlySet<DevMapEntityType>,
    zoom: number,
): DevMapClickCandidate | null {
    const layerId = feature.layer?.id;
    if (!layerId) return null;

    const entry = resolveEntityEntryForLayerId(layerId);
    if (!entry || !entry.supported) return null;
    if (!enabled.has(entry.entityType)) return null;
    if (zoom < entry.minSelectableZoom) return null;

    const identity = normalizeDevMapFeatureIdentity(entry, feature);
    if (!identity) return null;

    const sourceLayer =
        (feature as { sourceLayer?: string }).sourceLayer ??
        entry.sourceLayers[0] ??
        "";

    const lifecycleEntity = lifecycleEntityForLayerId(layerId);
    const selectionPriority = lifecycleEntity
        ? DEV_MAP_LIFECYCLE_SELECTION_PRIORITY[lifecycleEntity]
        : entry.selectionPriority;

    return {
        entityType: entry.entityType,
        selectionPriority,
        feature,
        layerId,
        sourceLayer,
        ...identity,
    };
}

/** Deterministic primary pick: lowest selectionPriority wins; ties keep first query order. */
export function pickPrimaryDevMapCandidate(
    candidates: readonly DevMapClickCandidate[],
): DevMapClickCandidate | null {
    if (candidates.length === 0) return null;
    let best = candidates[0]!;
    for (let i = 1; i < candidates.length; i += 1) {
        const next = candidates[i]!;
        if (next.selectionPriority < best.selectionPriority) {
            best = next;
        }
    }
    return best;
}

export function candidateToSelection(candidate: DevMapClickCandidate): DevMapSelection | null {
    const geometry = candidate.feature.geometry as Geometry | null;
    if (!geometry) return null;
    const entry = getDevMapEntityEntry(candidate.entityType);
    return {
        entityType: candidate.entityType,
        entityId: candidate.entityId,
        featureKey: candidate.featureKey,
        coreId: candidate.coreId,
        corePublicId: candidate.corePublicId,
        displayName: candidate.displayName,
        sourceLayer: candidate.sourceLayer,
        layerId: candidate.layerId,
        geometry,
        detailRoute: entry.detailRoute,
        detailApi: entry.detailApi,
    };
}

/**
 * Hit-test enabled layers at a screen point and return one normalized selection.
 * Lifecycle overlay layers beat static PMTiles building/land geometry.
 * No network I/O.
 */
export function resolveDevMapClickSelection(
    map: DevMapClickMap,
    point: DevMapClickPoint,
    enabled: ReadonlySet<DevMapEntityType>,
): DevMapSelection | null {
    const layers = listQueryableDevMapLayerIds(map, enabled);
    if (layers.length === 0) {
        return null;
    }

    const features = map.queryRenderedFeatures(point, { layers });
    const zoom = map.getZoom();
    const candidates: DevMapClickCandidate[] = [];
    for (const feature of features) {
        const candidate = candidateFromFeature(feature, enabled, zoom);
        if (candidate) {
            candidates.push(candidate);
        }
    }

    const primary = pickPrimaryDevMapCandidate(candidates);
    if (!primary) return null;
    return candidateToSelection(primary);
}

/** Test helper: build a minimal MapLibre-like feature. */
export function testMapFeature(options: {
    layerId: string;
    sourceLayer?: string;
    properties: Record<string, unknown>;
    geometry?: Geometry;
}): MapGeoJSONFeature {
    return {
        type: "Feature",
        geometry: options.geometry ?? {
            type: "LineString",
            coordinates: [
                [96, 16],
                [96.1, 16.1],
            ],
        },
        properties: options.properties,
        layer: { id: options.layerId },
        source: "region-yangon",
        sourceLayer: options.sourceLayer ?? "streets",
        state: {},
    } as MapGeoJSONFeature;
}
