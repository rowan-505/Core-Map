import { fieldRouteEditorHref, fieldStopEditorHref } from "./fieldReportLinks";
import type { AdminReportDetail, FieldReportContext } from "./types";

export type EvidenceMapPoint = {
    latitude: number;
    longitude: number;
    accuracyM?: number | null;
    role: "canonical" | "observed" | "proposed";
};

export function privateMediaAccessPath(assetPublicId: string) {
    return `/admin/media/${encodeURIComponent(assetPublicId)}/access`;
}

export function fieldTransportEditorHref(field: FieldReportContext | null): string | null {
    if (!field) {
        return null;
    }
    if (field.stop_public_id) {
        return fieldStopEditorHref(field.stop_public_id);
    }
    if (field.route_public_id) {
        return fieldRouteEditorHref(field.route_public_id);
    }
    return null;
}

export function sessionFinalizationLabel(status: string | null | undefined): string {
    switch (status) {
        case "completed":
            return "Survey session completed";
        case "abandoned":
            return "Survey session abandoned";
        case "active":
            return "Survey session still active";
        default:
            return "No survey session linked";
    }
}

export function evidenceMapPoints(report: Pick<AdminReportDetail, "canonical_target" | "field">): EvidenceMapPoint[] {
    const points: EvidenceMapPoint[] = [];
    const canonical = report.canonical_target;
    if (canonical) {
        points.push({
            latitude: canonical.latitude,
            longitude: canonical.longitude,
            role: "canonical",
        });
    }
    const observed = report.field?.observed_location;
    if (observed) {
        points.push({
            latitude: observed.latitude,
            longitude: observed.longitude,
            accuracyM: observed.accuracy_m,
            role: "observed",
        });
    }
    const proposed = report.field?.proposed_location;
    if (proposed) {
        points.push({
            latitude: proposed.latitude,
            longitude: proposed.longitude,
            role: "proposed",
        });
    }
    return points;
}

/** Approximate closed ring in WGS84 for a GPS accuracy circle. */
export function accuracyCircleCoordinates(
    longitude: number,
    latitude: number,
    radiusM: number,
    steps = 48
): [number, number][] {
    const latRad = (latitude * Math.PI) / 180;
    const metersPerDegLat = 111_320;
    const metersPerDegLng = 111_320 * Math.cos(latRad);
    const ring: [number, number][] = [];
    for (let i = 0; i <= steps; i += 1) {
        const angle = (i / steps) * 2 * Math.PI;
        const dLat = (Math.sin(angle) * radiusM) / metersPerDegLat;
        const dLng = (Math.cos(angle) * radiusM) / Math.max(metersPerDegLng, 1);
        ring.push([longitude + dLng, latitude + dLat]);
    }
    return ring;
}
