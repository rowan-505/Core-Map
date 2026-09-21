import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";
import type { DataReviewEntityType } from "@/src/components/map/DataReviewCandidateMap";
import type { DataReviewGeoJson } from "@/src/lib/api";

import type {
    CoreReviewBuildingRow,
    CoreReviewPlaceRow,
    CoreReviewStreetRow,
} from "../config/types";
import { dash } from "./formatters";

export function geometryFromRow(
    row: Record<string, unknown>,
    geometryKind: DataReviewGeometryKind | "none"
): DataReviewGeoJson | null {
    if (geometryKind === "none") {
        return null;
    }
    const g = row.geometry;
    if (g && typeof g === "object" && "type" in g) {
        return g as DataReviewGeoJson;
    }
    if (geometryKind === "point" && typeof row.lat === "number" && typeof row.lng === "number") {
        return { type: "Point", coordinates: [row.lng, row.lat] };
    }
    return null;
}

export function rowId(
    row: Record<string, unknown>,
    idKind: "public_id" | "numeric_id"
): string {
    if (idKind === "public_id") {
        const pid = row.publicId ?? row.public_id;
        return String(pid ?? "");
    }
    return String(row.id ?? "");
}

export function mapEntityTypeForKind(
    kind: DataReviewGeometryKind | "none"
): DataReviewEntityType {
    if (kind === "polygon") {
        return "building";
    }
    if (kind === "line") {
        return "road";
    }
    if (kind === "point") {
        return "place";
    }
    return "generic";
}

export type { CoreReviewBuildingRow, CoreReviewPlaceRow, CoreReviewStreetRow };

export function buildingDisplayName(row: CoreReviewBuildingRow): string {
    return dash(row.name ?? row.nameEn ?? row.nameMm ?? row.publicId);
}

export function placeDisplayName(row: CoreReviewPlaceRow): string {
    return row.displayName || row.primaryName || row.publicId;
}

export function streetDisplayName(row: CoreReviewStreetRow): string {
    return row.canonicalName || row.publicId;
}
