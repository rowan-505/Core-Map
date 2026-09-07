import { canonicalYbsVariantIdentity } from "../transport/ybs-direction.js";
import type { FieldRoute, FieldRoutePath, FieldRouteStop, FieldStop, FieldVariant } from "./field.schema.js";

export type FieldRouteRow = {
    public_id: string;
    route_code: string;
    name_my: string | null;
    name_en: string | null;
};

export type FieldVariantRow = {
    public_id: string;
    route_public_id: string;
    route_code: string;
    direction_id: number;
    origin_name: string | null;
    destination_name: string | null;
};

export type FieldStopRow = {
    public_id: string;
    stop_code: string | null;
    name_my: string | null;
    name_en: string | null;
    lat: number;
    lng: number;
};

export type FieldRouteStopRow = {
    variant_public_id: string;
    stop_public_id: string;
    stop_sequence: number;
};

export type FieldRoutePathRow = {
    variant_public_id: string;
    geometry: unknown;
};

export function toFieldRoute(row: FieldRouteRow): FieldRoute {
    return {
        publicId: row.public_id,
        routeCode: row.route_code,
        nameMy: row.name_my,
        nameEn: row.name_en,
    };
}

export function toFieldVariant(row: FieldVariantRow): FieldVariant | null {
    const identity = canonicalYbsVariantIdentity(row.route_code, row.direction_id);
    if (!identity) {
        return null;
    }
    return {
        publicId: row.public_id,
        routePublicId: row.route_public_id,
        variantCode: identity.directionName,
        directionId: identity.directionId,
        originName: row.origin_name,
        destinationName: row.destination_name,
        oppositeVariantPublicId: null,
    };
}

/**
 * Pairs D0/D1 using the same route public id and the opposite direction id.
 * Does not reverse geometry and does not invent an id by rewriting D0/D1 text.
 */
export function withOppositeVariantPublicIds(variants: FieldVariant[]): FieldVariant[] {
    const byRoute = new Map<string, FieldVariant[]>();
    for (const variant of variants) {
        const group = byRoute.get(variant.routePublicId) ?? [];
        group.push(variant);
        byRoute.set(variant.routePublicId, group);
    }
    return variants.map((variant) => {
        const group = byRoute.get(variant.routePublicId) ?? [];
        const sameDirection = group.filter((row) => row.directionId === variant.directionId);
        const opposites = group.filter(
            (row) => row.publicId !== variant.publicId && row.directionId === (variant.directionId === 0 ? 1 : 0)
        );
        return {
            ...variant,
            oppositeVariantPublicId:
                sameDirection.length === 1 && opposites.length === 1 ? opposites[0].publicId : null,
        };
    });
}

export function toFieldStop(row: FieldStopRow): FieldStop | null {
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) {
        return null;
    }
    return {
        publicId: row.public_id,
        stopCode: row.stop_code,
        nameMy: row.name_my,
        nameEn: row.name_en,
        lat: row.lat,
        lng: row.lng,
    };
}

export function toFieldRouteStop(row: FieldRouteStopRow): FieldRouteStop | null {
    if (!Number.isInteger(row.stop_sequence) || row.stop_sequence < 1) {
        return null;
    }
    return {
        variantPublicId: row.variant_public_id,
        stopPublicId: row.stop_public_id,
        stopSequence: row.stop_sequence,
    };
}

export function toFieldRoutePath(row: FieldRoutePathRow): FieldRoutePath | null {
    const geometry = asLineString(row.geometry);
    if (!geometry) {
        return null;
    }
    return {
        variantPublicId: row.variant_public_id,
        geometry,
    };
}

export function asLineString(
    value: unknown
): { type: "LineString"; coordinates: [number, number][] } | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const geom = value as { type?: unknown; coordinates?: unknown };
    if (geom.type !== "LineString" || !Array.isArray(geom.coordinates) || geom.coordinates.length < 2) {
        return null;
    }
    const coordinates: [number, number][] = [];
    for (const pair of geom.coordinates) {
        if (!Array.isArray(pair) || pair.length < 2) {
            return null;
        }
        const lng = Number(pair[0]);
        const lat = Number(pair[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            return null;
        }
        coordinates.push([lng, lat]);
    }
    return { type: "LineString", coordinates };
}

/** About 0.1 m. Enough for field survey; smaller JSON than full-precision OSM vertices. */
export function roundFieldCoordinate(value: number): number {
    return Math.round(value * 1e6) / 1e6;
}

export function roundFieldStopCoordinates<T extends { lat: number; lng: number }>(stop: T): T {
    return {
        ...stop,
        lat: roundFieldCoordinate(stop.lat),
        lng: roundFieldCoordinate(stop.lng),
    };
}

export function roundFieldPathCoordinates(
    path: FieldRoutePath
): FieldRoutePath {
    return {
        ...path,
        geometry: {
            type: "LineString",
            coordinates: path.geometry.coordinates.map(([lng, lat]) => [
                roundFieldCoordinate(lng),
                roundFieldCoordinate(lat),
            ]),
        },
    };
}

export function sortRouteStops(items: FieldRouteStop[]): FieldRouteStop[] {
    return [...items].sort((a, b) => {
        const variant = a.variantPublicId.localeCompare(b.variantPublicId);
        if (variant !== 0) {
            return variant;
        }
        return a.stopSequence - b.stopSequence;
    });
}
