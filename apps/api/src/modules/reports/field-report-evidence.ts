import { isFieldSurveySource } from "./report-admin-status.js";
import type { ReportRow } from "./reports.repo.js";

export type GeoPoint = {
    latitude: number;
    longitude: number;
};

export type ObservedLocation = GeoPoint & {
    accuracy_m: number | null;
};

export type FieldReportAdminContext = {
    route_code: string | null;
    route_public_id: string | null;
    variant_code: string | null;
    variant_public_id: string | null;
    origin_name: string | null;
    destination_name: string | null;
    stop_public_id: string | null;
    stop_name: string | null;
    stop_sequence: number | null;
    snapshot_revision: string | null;
    snapshot_stale: boolean;
    current_snapshot_revision: string | null;
    survey_session_public_id: string | null;
    survey_session_status: string | null;
    canonical_snapshot: unknown | null;
    observed_location: ObservedLocation | null;
    proposed_location: GeoPoint | null;
};

export function fieldStopPublicIdOf(row: ReportRow): string | null {
    return fieldStopPublicId(row, asRecord(row.report_data));
}

export function toFieldContext(
    row: ReportRow,
    currentSnapshotRevision: string | null = null
): FieldReportAdminContext | null {
    if (!isFieldSurveySource(row.source_code)) {
        return null;
    }
    const data = asRecord(row.report_data);
    const snapshot = asRecord(data.canonicalSnapshot);
    const snapshotRevision = optionalString(data.snapshotRevision);
    const reportPoint = geoPoint(row.latitude, row.longitude);
    const observer = geoPoint(snapshot.observerLat, snapshot.observerLng);
    const corrected = geoPoint(snapshot.correctedLat, snapshot.correctedLng);
    const observed =
        observer != null
            ? {
                  ...observer,
                  accuracy_m: optionalFinite(snapshot.observerAccuracyM) ?? optionalFinite(row.location_accuracy_m),
              }
            : corrected == null && reportPoint != null
              ? {
                    ...reportPoint,
                    accuracy_m: optionalFinite(row.location_accuracy_m),
                }
              : null;
    const proposed = corrected ?? (observer != null ? reportPoint : null);

    return {
        route_code: row.field_route_code ?? optionalString(data.routeCode),
        route_public_id: fieldRoutePublicId(row, data),
        variant_code: optionalString(data.variantCode),
        variant_public_id: optionalString(data.variantPublicId),
        origin_name: row.field_origin_name ?? null,
        destination_name: row.field_destination_name ?? null,
        stop_public_id: fieldStopPublicId(row, data),
        stop_name: row.field_stop_name ?? null,
        stop_sequence: optionalInt(data.stopSequence) ?? optionalInt(snapshot.stopSequence),
        snapshot_revision: snapshotRevision,
        snapshot_stale: Boolean(
            snapshotRevision && currentSnapshotRevision && snapshotRevision !== currentSnapshotRevision
        ),
        current_snapshot_revision: currentSnapshotRevision,
        survey_session_public_id: row.survey_session_public_id ?? null,
        survey_session_status: row.survey_session_status ?? null,
        canonical_snapshot: data.canonicalSnapshot === undefined ? null : data.canonicalSnapshot,
        observed_location: observed,
        proposed_location: proposed,
    };
}

function fieldStopPublicId(row: ReportRow, data: Record<string, unknown>): string | null {
    const fromContext = optionalString(data.stopPublicId);
    if (fromContext) {
        return fromContext;
    }
    if (row.target_entity_type === "stop") {
        return row.target_public_id;
    }
    return null;
}

function fieldRoutePublicId(row: ReportRow, data: Record<string, unknown>): string | null {
    const fromContext = optionalString(data.routePublicId);
    if (fromContext) {
        return fromContext;
    }
    if (row.target_entity_type === "route") {
        return row.target_public_id;
    }
    return null;
}

function geoPoint(lat: unknown, lng: unknown): GeoPoint | null {
    const latitude = optionalFinite(lat);
    const longitude = optionalFinite(lng);
    if (latitude === null || longitude === null) {
        return null;
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return null;
    }
    return { latitude, longitude };
}

function asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

function optionalString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function optionalInt(value: unknown): number | null {
    if (typeof value === "number" && Number.isInteger(value)) {
        return value;
    }
    if (typeof value === "string" && /^-?\d+$/.test(value)) {
        return Number(value);
    }
    return null;
}

function optionalFinite(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
