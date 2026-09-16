import type { Geometry } from "geojson";
import type { Map as MaplibreMap } from "maplibre-gl";
import { LngLatBounds } from "maplibre-gl";

import {
    getBuilding,
    getCoreReviewDetail,
    getCoreReviewList,
    getPlace,
    getStreet,
} from "@/src/lib/api";
import {
    fetchLocalBasemapFeature,
    searchLocalBasemapFeatures,
    type LocalBasemapEntity,
    type LocalBasemapSearchHit,
} from "@/src/features/local-basemap/localBasemapApi";
import { listSearchDocuments } from "@/src/features/search/api";
import type { SearchDocumentItem } from "@/src/features/search/types";
import {
    getTransportRouteDetail,
    getTransportRouteVariants,
    getTransportStopDetail,
    getTransportVariantOrderedStops,
    getTransportVariantStops,
} from "@/src/features/transport/api";

import { getDevMapEntityEntry, type DevMapEntityType } from "./devMapEntityRegistry";
import type { DevMapSelection } from "./devMapSelection";

export type DevMapSearchHitSource = "search_documents" | "local_basemap" | "core_review";

export type DevMapSearchHit = {
    key: string;
    entityType: DevMapEntityType;
    label: string;
    subtitle: string | null;
    entityId: string;
    publicId: string | null;
    featureKey: string | null;
    source: DevMapSearchHitSource;
};

/** Search-index entity_type → Dev Map entity. */
const SEARCH_DOC_TO_DEV_MAP: Partial<Record<string, DevMapEntityType>> = {
    place: "places",
    admin_area: "admin",
    street_group: "streets",
    transport_stop: "transport_stops",
    transport_route: "transport_routes",
    building: "buildings",
    land_area: "land",
};

export const DEV_MAP_SEARCH_SUPPORTED_TYPES: readonly DevMapEntityType[] = [
    "places",
    "streets",
    "admin",
    "transport_stops",
    "transport_routes",
    "buildings",
    "land",
    "settlements",
];

/** Intentionally not first-class in this phase. */
export const DEV_MAP_SEARCH_DEFERRED = [
    "settlements in unified search documents index (use core-review list search)",
    "transport_terminal / transport_route_variant layers",
    "addresses",
    "full-table building/land name scan without local-basemap or search index",
] as const;

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;
const DOC_PAGE_SIZE = 8;
const LOCAL_LIMIT = 6;
const SETTLEMENT_LIMIT = 5;

export function getDevMapSearchDebounceMs(): number {
    return DEBOUNCE_MS;
}

/** Exact feature_key or long OSM id — prefer local-basemap exact search first. */
export function looksLikeLocalBasemapIdQuery(q: string): boolean {
    const trimmed = q.trim();
    if (/^osm:(node|way|relation):\d+$/i.test(trimmed)) {
        return true;
    }
    if (/^\d{6,}$/.test(trimmed)) {
        return true;
    }
    return false;
}

export function mapSearchDocumentToDevMapEntity(entityType: string): DevMapEntityType | null {
    return SEARCH_DOC_TO_DEV_MAP[entityType] ?? null;
}

function asGeometry(value: unknown): Geometry | null {
    if (!value || typeof value !== "object") return null;
    const g = value as { type?: string; coordinates?: unknown };
    if (!g.type || g.coordinates == null) return null;
    return value as Geometry;
}

function pointGeometry(lng: unknown, lat: unknown): Geometry | null {
    const x = typeof lng === "number" ? lng : Number(lng);
    const y = typeof lat === "number" ? lat : Number(lat);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { type: "Point", coordinates: [x, y] };
}

function docHit(doc: SearchDocumentItem): DevMapSearchHit | null {
    const entityType = mapSearchDocumentToDevMapEntity(doc.entity_type);
    if (!entityType) return null;
    const label =
        doc.display_name?.trim() ||
        doc.primary_name_en?.trim() ||
        doc.primary_name_my?.trim() ||
        doc.entity_id;
    return {
        key: `doc:${doc.entity_type}:${doc.entity_id}`,
        entityType,
        label,
        subtitle: `${doc.entity_type}${doc.public_id ? ` · ${doc.public_id}` : ""}`,
        entityId: doc.public_id ?? doc.entity_id,
        publicId: doc.public_id,
        featureKey: null,
        source: "search_documents",
    };
}

function localHit(entity: LocalBasemapEntity, hit: LocalBasemapSearchHit): DevMapSearchHit {
    const entityType: DevMapEntityType = entity === "buildings" ? "buildings" : "land";
    return {
        key: `local:${entity}:${hit.feature_key}`,
        entityType,
        label: hit.name?.trim() || hit.feature_key,
        subtitle: `${hit.lifecycle_state}${hit.class_code ? ` · ${hit.class_code}` : ""} · ${hit.feature_key}`,
        entityId: hit.feature_key,
        publicId: null,
        featureKey: hit.feature_key,
        source: "local_basemap",
    };
}

function dedupeHits(hits: DevMapSearchHit[]): DevMapSearchHit[] {
    const seen = new Set<string>();
    const out: DevMapSearchHit[] = [];
    for (const hit of hits) {
        if (seen.has(hit.key)) continue;
        seen.add(hit.key);
        out.push(hit);
    }
    return out;
}

/**
 * Run Dev Map search. Callers debounce + abort.
 * Local feature_key/OSM id queries hit local-basemap first; otherwise admin search documents.
 */
export async function runDevMapSearch(
    rawQuery: string,
    signal: AbortSignal,
): Promise<DevMapSearchHit[]> {
    const q = rawQuery.trim();
    if (!q) return [];

    const preferLocal = looksLikeLocalBasemapIdQuery(q);
    if (!preferLocal && q.length < MIN_QUERY_LEN) {
        return [];
    }

    const hits: DevMapSearchHit[] = [];

    if (preferLocal) {
        const [buildings, land] = await Promise.all([
            searchLocalBasemapFeatures("buildings", q, signal).catch(() => ({ items: [] as LocalBasemapSearchHit[] })),
            searchLocalBasemapFeatures("land", q, signal).catch(() => ({ items: [] as LocalBasemapSearchHit[] })),
        ]);
        for (const item of buildings.items.slice(0, LOCAL_LIMIT)) {
            hits.push(localHit("buildings", item));
        }
        for (const item of land.items.slice(0, LOCAL_LIMIT)) {
            hits.push(localHit("land", item));
        }
        if (hits.length > 0) {
            return dedupeHits(hits);
        }
    }

    const docs = await listSearchDocuments(
        {
            q,
            is_active: true,
            page: 1,
            pageSize: DOC_PAGE_SIZE,
            sort: "name",
            order: "asc",
        },
        { signal },
    );
    for (const doc of docs.items) {
        const hit = docHit(doc);
        if (hit) hits.push(hit);
    }

    if (q.length >= MIN_QUERY_LEN) {
        try {
            const settlements = await getCoreReviewList<Record<string, unknown>>(
                "settlements",
                { search: q, page: 1, pageSize: SETTLEMENT_LIMIT },
                { signal },
            );
            for (const row of settlements.data) {
                const publicId = String(row.public_id ?? row.publicId ?? row.id ?? "").trim();
                if (!publicId) continue;
                const label = String(
                    row.canonical_name ?? row.canonicalName ?? row.name ?? publicId,
                );
                hits.push({
                    key: `settlement:${publicId}`,
                    entityType: "settlements",
                    label,
                    subtitle: "settlement",
                    entityId: publicId,
                    publicId,
                    featureKey: null,
                    source: "core_review",
                });
            }
        } catch {
            // Settlements list search is best-effort.
        }
    }

    return dedupeHits(hits);
}

function selectionShell(
    hit: DevMapSearchHit,
    geometry: Geometry,
    overrides: Partial<DevMapSelection> = {},
): DevMapSelection {
    const entry = getDevMapEntityEntry(hit.entityType);
    return {
        entityType: hit.entityType,
        entityId: overrides.entityId ?? hit.entityId,
        featureKey: overrides.featureKey ?? hit.featureKey,
        coreId: overrides.coreId ?? null,
        corePublicId: overrides.corePublicId ?? hit.publicId,
        displayName: overrides.displayName ?? hit.label,
        sourceLayer: overrides.sourceLayer ?? entry.sourceLayers[0] ?? "",
        layerId: overrides.layerId ?? entry.baseLayerIds[0] ?? "dev-map-search",
        geometry,
        detailRoute: entry.detailRoute,
        detailApi: entry.detailApi,
    };
}

/**
 * Fetch enough geometry from existing detail APIs, then build the same DevMapSelection
 * shape used by map click → inspector.
 */
export async function resolveDevMapSearchHitToSelection(
    hit: DevMapSearchHit,
    signal: AbortSignal,
): Promise<DevMapSelection> {
    switch (hit.entityType) {
        case "places": {
            const place = await getPlace(hit.publicId ?? hit.entityId, { signal });
            const geom = pointGeometry(place.lng, place.lat);
            if (!geom) {
                throw new Error("Place has no geometry.");
            }
            return selectionShell(hit, geom, {
                entityId: place.public_id ?? hit.entityId,
                corePublicId: place.public_id ?? hit.publicId,
                displayName: place.display_name ?? place.primary_name ?? hit.label,
            });
        }
        case "streets": {
            const street = await getStreet(hit.publicId ?? hit.entityId, { signal });
            const geom = asGeometry(street.geometry);
            if (!geom) {
                throw new Error("Street has no geometry.");
            }
            const streetId = (street as { id?: string | number }).id;
            return selectionShell(hit, geom, {
                entityId: street.public_id ?? hit.entityId,
                coreId: streetId != null ? String(streetId) : null,
                corePublicId: street.public_id ?? hit.publicId,
                displayName: street.canonical_name ?? street.englishName ?? hit.label,
            });
        }
        case "admin": {
            const res = await getCoreReviewDetail<Record<string, unknown>>(
                "admin-areas",
                hit.publicId ?? hit.entityId,
                { signal },
            );
            const row = res.data;
            const geom =
                asGeometry(row.geom) ??
                asGeometry(row.geometry) ??
                asGeometry(row.centroid);
            if (!geom) {
                throw new Error("Admin area has no geometry.");
            }
            return selectionShell(hit, geom, {
                entityId: String(row.public_id ?? row.publicId ?? row.id ?? hit.entityId),
                coreId: row.id != null ? String(row.id) : null,
                corePublicId:
                    row.public_id != null
                        ? String(row.public_id)
                        : row.publicId != null
                          ? String(row.publicId)
                          : hit.publicId,
                displayName: String(
                    row.canonical_name ?? row.canonicalName ?? row.name ?? hit.label,
                ),
            });
        }
        case "settlements": {
            const res = await getCoreReviewDetail<Record<string, unknown>>(
                "settlements",
                hit.publicId ?? hit.entityId,
                { signal },
            );
            const row = res.data;
            const geom =
                asGeometry(row.geometry) ??
                asGeometry(row.point_geom) ??
                pointGeometry(row.lng, row.lat);
            if (!geom) {
                throw new Error("Settlement has no geometry.");
            }
            return selectionShell(hit, geom, {
                entityId: String(row.public_id ?? row.publicId ?? row.id ?? hit.entityId),
                corePublicId:
                    row.public_id != null
                        ? String(row.public_id)
                        : row.publicId != null
                          ? String(row.publicId)
                          : hit.publicId,
                displayName: String(
                    row.canonical_name ?? row.canonicalName ?? row.name ?? hit.label,
                ),
            });
        }
        case "transport_stops": {
            const stop = await getTransportStopDetail(hit.publicId ?? hit.entityId, { signal });
            const geom =
                asGeometry(stop.geometry) ?? pointGeometry(stop.longitude, stop.latitude);
            if (!geom) {
                throw new Error("Transport stop has no geometry.");
            }
            return selectionShell(hit, geom, {
                entityId: stop.public_id ?? hit.entityId,
                corePublicId: stop.public_id ?? hit.publicId,
                displayName: stop.display_name ?? stop.name ?? hit.label,
            });
        }
        case "transport_routes": {
            const routeId = hit.publicId ?? hit.entityId;
            const route = await getTransportRouteDetail(routeId, { signal });
            const label = route.public_name ?? route.route_code ?? hit.label;
            const shell = {
                entityId: route.public_id ?? hit.entityId,
                corePublicId: route.public_id ?? hit.publicId,
                displayName: label,
            };

            const variants = await getTransportRouteVariants(route.public_id, { signal });
            const firstVariant = variants.items[0];
            if (firstVariant?.public_id) {
                const withPath = await getTransportVariantStops(
                    firstVariant.public_id,
                    { includePath: true, limit: 1 },
                    { signal },
                );
                const pathGeom = asGeometry(withPath.path?.geometry);
                if (pathGeom) {
                    return selectionShell(hit, pathGeom, shell);
                }

                const ordered = await getTransportVariantOrderedStops(firstVariant.public_id, {
                    signal,
                });
                const firstStop = ordered.ordered_stops[0];
                const stopGeom = firstStop
                    ? pointGeometry(
                          firstStop.actual_longitude ?? firstStop.longitude,
                          firstStop.actual_latitude ?? firstStop.latitude,
                      )
                    : null;
                if (stopGeom) {
                    return selectionShell(hit, stopGeom, shell);
                }
            }

            throw new Error("Transport route has no path or stop geometry.");
        }
        case "buildings":
        case "land": {
            if (hit.featureKey || hit.source === "local_basemap") {
                const entity: LocalBasemapEntity =
                    hit.entityType === "buildings" ? "buildings" : "land";
                const detail = await fetchLocalBasemapFeature(
                    entity,
                    hit.featureKey ?? hit.entityId,
                    signal,
                );
                const geom = asGeometry(detail.geometry);
                if (!geom) {
                    throw new Error("Local feature has no geometry.");
                }
                return selectionShell(hit, geom, {
                    entityId: detail.feature_key,
                    featureKey: detail.feature_key,
                    coreId: detail.core_id,
                    corePublicId: detail.core_public_id,
                    displayName: detail.name_en ?? detail.name ?? detail.feature_key,
                });
            }
            if (hit.entityType === "buildings") {
                const building = await getBuilding(hit.publicId ?? hit.entityId, { signal });
                const geom = asGeometry(building.geometry);
                if (!geom) {
                    throw new Error("Building has no geometry.");
                }
                return selectionShell(hit, geom, {
                    entityId: building.public_id ?? hit.entityId,
                    corePublicId: building.public_id ?? hit.publicId,
                    coreId: building.id,
                    displayName: building.name ?? hit.label,
                });
            }
            const res = await getCoreReviewDetail<Record<string, unknown>>(
                "land-areas",
                hit.publicId ?? hit.entityId,
                { signal },
            );
            const geom = asGeometry(res.data.geom) ?? asGeometry(res.data.geometry);
            if (!geom) {
                throw new Error("Land area has no geometry.");
            }
            return selectionShell(hit, geom, {
                entityId: String(res.data.public_id ?? res.data.id ?? hit.entityId),
                corePublicId:
                    res.data.public_id != null ? String(res.data.public_id) : hit.publicId,
                displayName: String(res.data.name ?? res.data.canonical_name ?? hit.label),
            });
        }
        default:
            throw new Error(`Search resolve not supported for ${hit.entityType}.`);
    }
}

/** Auto-enable supported entity types when a search hit is selected (simplest consistent UX). */
export function shouldAutoEnableEntityForSearchHit(
    entityType: DevMapEntityType,
    enabled: ReadonlySet<DevMapEntityType>,
): boolean {
    const entry = getDevMapEntityEntry(entityType);
    return entry.supported && !enabled.has(entityType);
}

/** Move camera to selection geometry without changing filter state. */
export function flyToDevMapSelection(map: MaplibreMap, selection: DevMapSelection): void {
    const geometry = selection.geometry;
    if (geometry.type === "Point") {
        const [lng, lat] = geometry.coordinates;
        map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16), essential: true });
        return;
    }

    const bounds = new LngLatBounds();
    const extend = (coords: number[] | number[][] | number[][][] | number[][][][]) => {
        if (typeof coords[0] === "number") {
            bounds.extend(coords as [number, number]);
            return;
        }
        for (const c of coords as Array<number[] | number[][] | number[][][]>) {
            extend(c as never);
        }
    };

    if (geometry.type === "LineString" || geometry.type === "MultiPoint") {
        extend(geometry.coordinates);
    } else if (geometry.type === "MultiLineString" || geometry.type === "Polygon") {
        extend(geometry.coordinates);
    } else if (geometry.type === "MultiPolygon") {
        extend(geometry.coordinates);
    } else {
        return;
    }

    if (bounds.isEmpty()) return;
    map.fitBounds(bounds, { padding: 64, maxZoom: 18, duration: 600 });
}
