import type { AdminReport, AdminReportDetail, FieldReportContext } from "./types";
import type { EvidenceMapPoint } from "./fieldEvidenceView";
import { evidenceMapPoints } from "./fieldEvidenceView";

const POINT_EPS = 1e-5;

export function isNewStopReport(code: string | null | undefined): boolean {
    return code === "new_stop";
}

export function locationSourceLabel(source: string | null | undefined): string {
    if (source === "GPS") {
        return "GPS";
    }
    if (source === "MAP_PICK") {
        return "Map pick";
    }
    return source?.trim() ? source : "—";
}

export function proposedGeometryLabel(source: string | null | undefined): string {
    if (source === "MAP_PICK") {
        return "Proposed new stop (map pick)";
    }
    if (source === "GPS") {
        return "Proposed new stop (GPS)";
    }
    return "Proposed new stop";
}

export function sameGeoPoint(
    a: { latitude: number; longitude: number } | null | undefined,
    b: { latitude: number; longitude: number } | null | undefined
): boolean {
    if (!a || !b) {
        return false;
    }
    return Math.abs(a.latitude - b.latitude) < POINT_EPS && Math.abs(a.longitude - b.longitude) < POINT_EPS;
}

export function haversineMeters(
    a: { latitude: number; longitude: number },
    b: { latitude: number; longitude: number }
): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function gpsToProposedDistanceM(field: FieldReportContext | null): number | null {
    const observed = field?.observed_location;
    const proposed = field?.proposed_location;
    if (!observed || !proposed || sameGeoPoint(observed, proposed)) {
        return null;
    }
    return haversineMeters(observed, proposed);
}

export function previousStopLabel(field: FieldReportContext | null): string {
    if (!field?.previous_stop_public_id && !field?.stop_name) {
        return "—";
    }
    const name = field.stop_name ?? field.previous_stop_public_id ?? "—";
    const sequence =
        field.previous_stop_sequence != null
            ? field.previous_stop_sequence
            : field.stop_sequence;
    const seq = sequence != null ? ` · sequence ${sequence}` : "";
    return `${name}${seq}`;
}

export function nextStopLabel(field: FieldReportContext | null): string {
    return field?.next_stop_public_id?.trim() ? field.next_stop_public_id : "None";
}

export function newStopCanonicalPublishEnabled(): false {
    return false;
}

export function newStopReviewMapPoints(
    report: Pick<AdminReportDetail, "canonical_target" | "field" | "report_type">
): EvidenceMapPoint[] {
    if (!isNewStopReport(report.report_type.code)) {
        return evidenceMapPoints(report);
    }
    const points: EvidenceMapPoint[] = [];
    const canonical = report.canonical_target;
    if (canonical) {
        points.push({
            latitude: canonical.latitude,
            longitude: canonical.longitude,
            role: "canonical",
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
    const observed = report.field?.observed_location;
    if (observed && !sameGeoPoint(observed, proposed)) {
        points.push({
            latitude: observed.latitude,
            longitude: observed.longitude,
            accuracyM: observed.accuracy_m,
            role: "observed",
        });
    }
    return points;
}

export type EvidenceMapLabels = Record<EvidenceMapPoint["role"], string>;

export function evidenceMapLabels(report: Pick<AdminReport, "report_type" | "field">): EvidenceMapLabels {
    if (isNewStopReport(report.report_type.code)) {
        return {
            canonical: "Previous canonical stop",
            observed: "Captured GPS",
            proposed: proposedGeometryLabel(report.field?.location_source),
        };
    }
    return {
        canonical: "Current canonical stop",
        observed: "Observed surveyor location",
        proposed: "Proposed corrected location",
    };
}
