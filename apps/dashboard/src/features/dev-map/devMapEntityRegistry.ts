import { coreReviewPath, transportPath } from "@/src/lib/dashboardPaths";

/**
 * Dev Map entity registry — maps UI filters to real basemap layers (or marks unsupported).
 * Not a plugin framework. Click selection uses these fields via `devMapClickSelect`.
 */

export type DevMapSourceKind = "pmtiles" | "dynamic" | "lifecycle-mvt";

export type DevMapEntityType =
    | "buildings"
    | "land"
    | "streets"
    | "admin"
    | "settlements"
    | "places"
    | "transport_stops"
    | "transport_routes"
    | "water"
    | "protected_areas";

export type DevMapEntityEntry = {
    entityType: DevMapEntityType;
    label: string;
    /** False when the current Dev Map stack has no renderable layers/source for this type. */
    supported: boolean;
    unsupportedReason?: string;
    sourceKind: DevMapSourceKind;
    /**
     * MapLibre source id hint. Regional PMTiles use `region-{id}` at runtime;
     * template in base-map.json is `local-basemap`.
     */
    sourceId: string | null;
    sourceLayers: readonly string[];
    /** Template layer ids from public `base-map.json` (regional clones append `-{regionId}`). */
    baseLayerIds: readonly string[];
    /** Property on rendered features used for detail lookup when selection exists. */
    stableIdProperty: string | null;
    /** Lower number = preferred when multiple features hit under a click (future). */
    selectionPriority: number;
    minSelectableZoom: number;
    detailRoute: string | null;
    detailApi: string | null;
    defaultVisible: boolean;
};

const STREET_LAYER_IDS = [
    "road-minor-casing",
    "road-minor-fill",
    "road-local-casing",
    "road-local-fill",
    "road-medium-casing",
    "road-medium-fill",
    "road-major-casing",
    "road-major-fill",
    "road-labels-major",
    "road-labels-medium",
    "road-labels-local",
] as const;

const ADMIN_LAYER_IDS = [
    "admin-boundaries",
    "admin-labels-township",
    "admin-labels-ward-village-tract",
    "admin-labels-village-local",
] as const;

const WATER_LAYER_IDS = ["water-polygons", "water-lines"] as const;

/**
 * Ordered registry. Supported entries must reference real `base-map.json` layer ids.
 * Unsupported entries stay listed for the filter UI but are not selectable/toggleable on-map.
 *
 * selectionPriority (lower = preferred on click):
 * places(3) → transport_stops(4) → buildings(10) → streets(25) → settlements(30)
 * → transport_routes(32) → land(40) → admin(50) → water(60) → protected_areas(70)
 * Lifecycle overlays still use lower priorities (5/8) than static buildings/land.
 */
export const DEV_MAP_ENTITY_REGISTRY: readonly DevMapEntityEntry[] = [
    {
        entityType: "buildings",
        label: "Buildings",
        supported: true,
        sourceKind: "pmtiles",
        sourceId: "local-basemap",
        sourceLayers: ["buildings"],
        baseLayerIds: ["buildings"],
        stableIdProperty: "feature_key",
        selectionPriority: 10,
        minSelectableZoom: 13,
        detailRoute: `${coreReviewPath("buildings")}/[id]/edit`,
        detailApi: "/core-review/buildings/:id",
        defaultVisible: true,
    },
    {
        entityType: "land",
        label: "Land",
        supported: true,
        sourceKind: "pmtiles",
        sourceId: "local-basemap",
        sourceLayers: ["landuse"],
        baseLayerIds: ["landuse"],
        stableIdProperty: "feature_key",
        selectionPriority: 40,
        minSelectableZoom: 9,
        detailRoute: `${coreReviewPath("land-areas")}/[id]/edit`,
        detailApi: "/core-review/land-areas/:id",
        defaultVisible: true,
    },
    {
        entityType: "streets",
        label: "Streets",
        supported: true,
        sourceKind: "pmtiles",
        sourceId: "local-basemap",
        sourceLayers: ["streets", "road_labels"],
        baseLayerIds: STREET_LAYER_IDS,
        stableIdProperty: "core_id",
        selectionPriority: 25,
        minSelectableZoom: 10,
        detailRoute: `${coreReviewPath("roads")}/[id]/edit`,
        detailApi: "/core-review/streets/:id",
        defaultVisible: true,
    },
    {
        entityType: "admin",
        label: "Admin",
        supported: true,
        sourceKind: "pmtiles",
        sourceId: "local-basemap",
        sourceLayers: ["admin_boundaries", "admin_area_label_points"],
        baseLayerIds: ADMIN_LAYER_IDS,
        stableIdProperty: "core_id",
        selectionPriority: 50,
        minSelectableZoom: 7,
        detailRoute: `${coreReviewPath("admin-areas")}/[id]/edit`,
        detailApi: "/core-review/admin-areas/:id",
        defaultVisible: true,
    },
    {
        entityType: "settlements",
        label: "Settlements",
        supported: false,
        unsupportedReason: "Present in regional PMTiles export but not styled in base-map.json",
        sourceKind: "pmtiles",
        sourceId: null,
        sourceLayers: ["settlements"],
        baseLayerIds: [],
        stableIdProperty: "core_public_id",
        selectionPriority: 30,
        minSelectableZoom: 6,
        detailRoute: `${coreReviewPath("settlements")}/[id]/edit`,
        detailApi: "/core-review/settlements/:id",
        defaultVisible: false,
    },
    {
        entityType: "places",
        label: "Places",
        supported: true,
        sourceKind: "dynamic",
        sourceId: "tiles_places_v",
        sourceLayers: ["tiles_places_v"],
        baseLayerIds: ["places-poi", "place-labels"],
        stableIdProperty: "public_id",
        selectionPriority: 3,
        minSelectableZoom: 12,
        detailRoute: `${coreReviewPath("places")}/[id]/edit`,
        detailApi: "/places/:id",
        defaultVisible: false,
    },
    {
        entityType: "transport_stops",
        label: "Transport Stops",
        supported: true,
        sourceKind: "dynamic",
        sourceId: "transport_stops_v",
        sourceLayers: ["transport_stops_v"],
        baseLayerIds: ["bus-stops"],
        stableIdProperty: "public_id",
        selectionPriority: 4,
        minSelectableZoom: 11,
        detailRoute: `${transportPath("stops")}/[publicId]`,
        detailApi: "/transport/stops/:publicId",
        defaultVisible: false,
    },
    {
        entityType: "transport_routes",
        label: "Transport Routes",
        supported: true,
        sourceKind: "dynamic",
        sourceId: "transport_route_paths_v",
        sourceLayers: ["transport_route_paths_v"],
        /** Prefer route_code for navigation (API accepts code); route_id is tile identity. */
        baseLayerIds: ["bus-routes"],
        stableIdProperty: "route_code",
        selectionPriority: 32,
        minSelectableZoom: 9,
        detailRoute: `${transportPath("routes")}/[publicId]`,
        detailApi: "/transport/routes/:publicId",
        defaultVisible: false,
    },
    {
        entityType: "water",
        label: "Water",
        supported: true,
        sourceKind: "pmtiles",
        sourceId: "local-basemap",
        sourceLayers: ["water_polygons", "water_lines"],
        baseLayerIds: WATER_LAYER_IDS,
        stableIdProperty: "core_id",
        selectionPriority: 60,
        minSelectableZoom: 8,
        detailRoute: `${coreReviewPath("water-polygons")}/[id]/edit`,
        detailApi: "/core-review/water-polygons/:id",
        defaultVisible: true,
    },
    {
        entityType: "protected_areas",
        label: "Protected Areas",
        supported: false,
        unsupportedReason: "Present in regional PMTiles export but not styled; no dashboard module",
        sourceKind: "pmtiles",
        sourceId: null,
        sourceLayers: ["protected_areas"],
        baseLayerIds: [],
        stableIdProperty: "core_public_id",
        selectionPriority: 70,
        minSelectableZoom: 8,
        detailRoute: null,
        detailApi: null,
        defaultVisible: false,
    },
] as const;

export type DevMapFilterPreset = "all" | "core" | "transport" | "clear";

/** Core Data preset: production PMTiles entities that are actually styled today. */
export const DEV_MAP_CORE_DATA_ENTITY_TYPES: readonly DevMapEntityType[] = [
    "buildings",
    "land",
    "streets",
    "admin",
    "water",
];

export const DEV_MAP_TRANSPORT_ENTITY_TYPES: readonly DevMapEntityType[] = [
    "transport_stops",
    "transport_routes",
];

const BY_TYPE = new Map(DEV_MAP_ENTITY_REGISTRY.map((entry) => [entry.entityType, entry]));

export function getDevMapEntityEntry(entityType: DevMapEntityType): DevMapEntityEntry {
    const entry = BY_TYPE.get(entityType);
    if (!entry) {
        throw new Error(`Unknown Dev Map entity type: ${entityType}`);
    }
    return entry;
}

export function listSupportedDevMapEntities(): readonly DevMapEntityEntry[] {
    return DEV_MAP_ENTITY_REGISTRY.filter((entry) => entry.supported);
}

export function createDefaultDevMapEnabledEntities(): Set<DevMapEntityType> {
    return new Set(
        DEV_MAP_ENTITY_REGISTRY.filter((entry) => entry.supported && entry.defaultVisible).map(
            (entry) => entry.entityType,
        ),
    );
}

/**
 * Entity types that may participate in future click selection.
 * Unsupported and unchecked types are excluded.
 */
export function getSelectableDevMapEntityTypes(
    enabled: ReadonlySet<DevMapEntityType>,
): DevMapEntityType[] {
    return DEV_MAP_ENTITY_REGISTRY.filter(
        (entry) => entry.supported && enabled.has(entry.entityType),
    ).map((entry) => entry.entityType);
}

export function isDevMapLayerIdForEntity(layerId: string, entry: DevMapEntityEntry): boolean {
    for (const baseId of entry.baseLayerIds) {
        if (layerId === baseId || layerId.startsWith(`${baseId}-`)) {
            return true;
        }
    }
    return false;
}
