import type { Point } from "geojson";

import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";
import type {
    BuildingGeometry,
    DataReviewGeoJson,
    StreetGeometry,
} from "@/src/lib/api";

/** Label for the fit control — matches import-review / building-editor wording per kind. */
export function coreReviewFitButtonLabel(geometryKind: DataReviewGeometryKind): string {
    if (geometryKind === "polygon") {
        return "Fit to polygon";
    }
    if (geometryKind === "line") {
        return "Fit to line";
    }
    return "Fit to point";
}

export function placeCoordinatesToGeoJson(
    lat: number | null | undefined,
    lng: number | null | undefined,
): Point | null {
    if (
        lat === null ||
        lat === undefined ||
        lng === null ||
        lng === undefined ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ) {
        return null;
    }

    return {
        type: "Point",
        coordinates: [lng, lat],
    };
}

export function buildingGeometryToGeoJson(
    geometry: BuildingGeometry | null | undefined,
): DataReviewGeoJson | null {
    if (!geometry) {
        return null;
    }
    return geometry as DataReviewGeoJson;
}

export function streetGeometryToGeoJson(
    geometry: StreetGeometry | null | undefined,
): DataReviewGeoJson | null {
    if (!geometry) {
        return null;
    }
    return geometry as DataReviewGeoJson;
}
