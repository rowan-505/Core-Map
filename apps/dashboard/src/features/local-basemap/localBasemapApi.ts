import { apiFetch } from "@/src/lib/api";

import type { LocalBasemapAction, LocalBasemapLifecycleState } from "./localBasemapActions";

export type LocalBasemapEntity = "buildings" | "land";

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
    operation: LocalBasemapAction;
    ok: boolean;
    sync_stale: boolean;
    message: string;
    detail?: LocalBasemapFeatureDetail | null;
    dependencies?: Array<{ code: string; count: number; message: string }>;
};

export async function fetchLocalBasemapStatus(signal?: AbortSignal) {
    return apiFetch<{ enabled: boolean; message: string }>("/local-basemap/status", { signal });
}

export async function searchLocalBasemapFeatures(
    entity: LocalBasemapEntity,
    q: string,
    signal?: AbortSignal
) {
    const params = new URLSearchParams({ q });
    return apiFetch<{ items: LocalBasemapSearchHit[] }>(
        `/local-basemap/${entity}/search?${params.toString()}`,
        { signal }
    );
}

export async function fetchLocalBasemapFeature(
    entity: LocalBasemapEntity,
    featureKey: string,
    signal?: AbortSignal,
    options: { includeGeometry?: boolean } = {},
) {
    const params =
        options.includeGeometry === true
            ? ({ includeGeometry: "1" } as Record<string, string>)
            : undefined;
    return apiFetch<LocalBasemapFeatureDetail>(
        `/local-basemap/${entity}/features/${encodeURIComponent(featureKey)}`,
        { signal },
        params,
    );
}

export async function runLocalBasemapAction(
    entity: LocalBasemapEntity,
    action: LocalBasemapAction,
    featureKey: string
): Promise<LocalBasemapActionResult> {
    const path =
        action === "clear_suppression"
            ? `/local-basemap/${entity}/clear-suppression`
            : `/local-basemap/${entity}/${action}`;
    const body: Record<string, string> = { feature_key: featureKey };
    if (action === "delete") {
        body.confirm = "DELETE";
    }
    if (action === "clear_suppression") {
        body.confirm = "CLEAR_SUPPRESSION";
    }
    return apiFetch<LocalBasemapActionResult>(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}
