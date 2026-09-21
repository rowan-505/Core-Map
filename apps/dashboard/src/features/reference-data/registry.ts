import { REFERENCE_TYPE_KEYS, type ReferenceTypeKey, type ReferenceUiConfig } from "./types";

const UI: Record<ReferenceTypeKey, Omit<ReferenceUiConfig, "key">> = {
    "poi-categories": {
        label: "POI categories",
        singularLabel: "POI category",
        description: "Categories for places and points of interest.",
    },
    "road-classes": {
        label: "Road classes",
        singularLabel: "Road class",
        description: "Classification for streets and roads.",
    },
    "building-types": {
        label: "Building types",
        singularLabel: "Building type",
        description: "Types for building footprints.",
    },
    "admin-levels": {
        label: "Admin levels",
        singularLabel: "Admin level",
        description: "Administrative hierarchy levels (country to ward).",
    },
    "admin-area-types": {
        label: "Admin area types",
        singularLabel: "Admin area type",
        description: "Semantic types for admin areas (state, township, etc.).",
    },
    "settlement-types": {
        label: "Settlement types",
        singularLabel: "Settlement type",
        description: "Types for settlements and villages.",
    },
    "source-types": {
        label: "Source types",
        singularLabel: "Source type",
        description: "Provenance labels for core entities.",
    },
    "address-component-types": {
        label: "Address component types",
        singularLabel: "Address component type",
        description: "Parts of structured addresses.",
    },
    "publish-statuses": {
        label: "Publish statuses",
        singularLabel: "Publish status",
        description: "Publication lifecycle for places.",
    },
    "report-types": {
        label: "Report types",
        singularLabel: "Report type",
        description: "User report categories.",
    },
    "report-statuses": {
        label: "Report statuses",
        singularLabel: "Report status",
        description: "User report workflow statuses.",
    },
    "land-area-classes": {
        label: "Land area classes",
        singularLabel: "Land area class",
        description: "Classes for land-use polygons.",
    },
    "water-classes": {
        label: "Water classes",
        singularLabel: "Water class",
        description: "Classes for water lines and polygons.",
    },
    "boundary-statuses": {
        label: "Boundary statuses",
        singularLabel: "Boundary status",
        description: "Official vs approximate boundary status for admin areas.",
    },
    "address-usage-types": {
        label: "Address usage types",
        singularLabel: "Address usage type",
        description: "How admin areas participate in address composition.",
    },
    "protected-area-classes": {
        label: "Protected area classes",
        singularLabel: "Protected area class",
        description: "Classes for protected areas and reserves.",
    },
    "tourism-types": {
        label: "Tourism types",
        singularLabel: "Tourism type",
        description: "Tourism profile categories.",
    },
    "activity-types": {
        label: "Activity types",
        singularLabel: "Activity type",
        description: "Tourism activity categories.",
    },
    "event-types": {
        label: "Event types",
        singularLabel: "Event type",
        description: "Tourism event categories.",
    },
};

const KEY_SET = new Set<string>(REFERENCE_TYPE_KEYS);

export function isReferenceTypeKey(value: string): value is ReferenceTypeKey {
    return KEY_SET.has(value);
}

export function getReferenceUiConfig(key: ReferenceTypeKey): ReferenceUiConfig {
    return { key, ...UI[key] };
}

export function listReferenceUiConfigs(): ReferenceUiConfig[] {
    return REFERENCE_TYPE_KEYS.map((key) => getReferenceUiConfig(key));
}
