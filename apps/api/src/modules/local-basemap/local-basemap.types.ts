export type LocalBasemapEntity = "buildings" | "land";

export type LocalBasemapLifecycleState = "base" | "archive" | "core" | "deleted" | "absent";

export type LocalBasemapAction = "promote" | "demote" | "delete" | "clear_suppression";

export type LocalBasemapSearchHit = {
    feature_key: string;
    lifecycle_state: LocalBasemapLifecycleState;
    name: string | null;
    class_code: string | null;
    osm_id: string | null;
    osm_feature_type: string | null;
};

export type LocalBasemapFeatureDetail = LocalBasemapSearchHit & {
    name_en: string | null;
    name_mm: string | null;
    core_id: string | null;
    core_public_id: string | null;
    source_identity: string;
    geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown } | null;
    geometry_source: LocalBasemapLifecycleState | null;
    available_actions: LocalBasemapAction[];
    local_layers: {
        base: boolean;
        archive: boolean;
        core: boolean;
        suppressed: boolean;
    };
};

export type LocalBasemapActionResult = {
    feature_key: string;
    operation: "promote" | "demote" | "delete" | "clear_suppression";
    ok: boolean;
    sync_stale: boolean;
    message: string;
    detail?: LocalBasemapFeatureDetail | null;
    dependencies?: Array<{ code: string; count: number; message: string }>;
};
