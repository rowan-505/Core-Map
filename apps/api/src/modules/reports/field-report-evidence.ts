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
    previous_stop_public_id: string | null;
    previous_stop_sequence: number | null;
    next_stop_public_id: string | null;
    proposed_stop_name: string | null;
    location_source: string | null;
    snapshot_revision: string | null;
    snapshot_stale: boolean;
    current_snapshot_revision: string | null;
    survey_session_public_id: string | null;
    survey_session_status: string | null;
    canonical_snapshot: unknown | null;
    observed_location: ObservedLocation | null;
    proposed_location: GeoPoint | null;
};

export type NormalizedComparisonValue = {
    name: string | null;
    coordinates: GeoPoint | null;
    sequence: number | null;
};

export type NormalizedFieldReportEvidence = {
    routePublicId: string | null;
    variantPublicId: string | null;
    stopPublicId: string | null;
    previousStopPublicId: string | null;
    nextStopPublicId: string | null;
    snapshotRevision: string | null;
    original: NormalizedComparisonValue | null;
    proposed: NormalizedComparisonValue | null;
    proposedLocationSource: string | null;
    observer: ObservedLocation | null;
    blockedReasons: string[];
};

export function fieldStopPublicIdOf(row: ReportRow): string | null {
    return fieldStopPublicId(row, asRecord(row.report_data));
}

/**
 * Strict field-evidence projection for admin review. Original values come only
 * from canonicalSnapshot; proposed coordinates come only from correctedLat/Lng.
 */
export function toNormalizedFieldEvidence(
    row: ReportRow
): NormalizedFieldReportEvidence | null {
    if (!isFieldSurveySource(row.source_code)) {
        return null;
    }

    const data = asRecord(row.report_data);
    const snapshot = asRecord(data.canonicalSnapshot);
    const blockedReasons: string[] = [];
    const originalPoint = strictPoint(
        snapshot,
        "lat",
        "lng",
        "Original coordinates are incomplete or invalid",
        blockedReasons
    );
    const proposedPoint = strictPoint(
        snapshot,
        "correctedLat",
        "correctedLng",
        "Proposed coordinates are incomplete or invalid",
        blockedReasons
    );
    const observerPoint = strictPoint(
        snapshot,
        "observerLat",
        "observerLng",
        "Observer coordinates are incomplete or invalid",
        blockedReasons
    );
    const reportPoint = geoPoint(row.latitude, row.longitude);
    const observerCoordinates = observerPoint ?? reportPoint;
    const observer =
        observerCoordinates === null
            ? null
            : {
                  ...observerCoordinates,
                  accuracy_m:
                      optionalNonNegativeFinite(snapshot.observerAccuracyM) ??
                      optionalNonNegativeFinite(row.location_accuracy_m),
              };

    const originalName =
        optionalString(snapshot.nameEn) ??
        optionalString(snapshot.nameMy) ??
        optionalString(snapshot.stopName);
    const originalSequence = optionalInt(snapshot.stopSequence);
    const proposedName = optionalString(data.proposedStopName);
    const proposedSequence = optionalInt(data.proposedStopSequence);

    return {
        routePublicId: optionalUuid(data.routePublicId),
        variantPublicId: optionalUuid(data.variantPublicId),
        stopPublicId:
            optionalUuid(data.stopPublicId) ??
            (row.report_type_code === "new_stop"
                ? optionalUuid(data.previousStopPublicId)
                : row.target_entity_type === "stop"
                  ? optionalUuid(row.target_public_id)
                  : null),
        previousStopPublicId: optionalUuid(data.previousStopPublicId),
        nextStopPublicId: optionalUuid(data.nextStopPublicId),
        snapshotRevision: optionalString(data.snapshotRevision),
        original:
            originalName !== null || originalPoint !== null || originalSequence !== null
                ? {
                      name: originalName,
                      coordinates: originalPoint,
                      sequence: originalSequence,
                  }
                : null,
        proposed:
            proposedName !== null || proposedPoint !== null || proposedSequence !== null
                ? {
                      name: proposedName,
                      coordinates: proposedPoint,
                      sequence: proposedSequence,
                  }
                : null,
        proposedLocationSource: optionalString(data.locationSource),
        observer,
        blockedReasons,
    };
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

    return {
        route_code: row.field_route_code ?? optionalString(data.routeCode),
        route_public_id: fieldRoutePublicId(row, data),
        variant_code: optionalString(data.variantCode),
        variant_public_id: optionalString(data.variantPublicId),
        origin_name: row.field_origin_name ?? null,
        destination_name: row.field_destination_name ?? null,
        stop_public_id: fieldStopPublicId(row, data),
        stop_name: row.field_stop_name ?? null,
        stop_sequence: optionalInt(data.stopSequence) ?? optionalInt(data.previousStopSequence) ?? optionalInt(snapshot.stopSequence),
        previous_stop_public_id: optionalString(data.previousStopPublicId),
        previous_stop_sequence: optionalInt(data.previousStopSequence),
        next_stop_public_id: optionalString(data.nextStopPublicId),
        proposed_stop_name: optionalString(data.proposedStopName),
        location_source: optionalString(data.locationSource),
        snapshot_revision: snapshotRevision,
        snapshot_stale: Boolean(
            snapshotRevision && currentSnapshotRevision && snapshotRevision !== currentSnapshotRevision
        ),
        current_snapshot_revision: currentSnapshotRevision,
        survey_session_public_id: row.survey_session_public_id ?? null,
        survey_session_status: row.survey_session_status ?? null,
        canonical_snapshot: data.canonicalSnapshot === undefined ? null : data.canonicalSnapshot,
        observed_location: observed,
        proposed_location: proposedLocation(row.report_type_code, corrected, observer, reportPoint),
    };
}

function proposedLocation(
    _reportTypeCode: string,
    corrected: GeoPoint | null,
    _observer: GeoPoint | null,
    _reportPoint: GeoPoint | null
): GeoPoint | null {
    return corrected;
}

function fieldStopPublicId(row: ReportRow, data: Record<string, unknown>): string | null {
    const fromContext =
        optionalString(data.stopPublicId) ?? optionalString(data.previousStopPublicId);
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

function strictPoint(
    source: Record<string, unknown>,
    latitudeKey: string,
    longitudeKey: string,
    invalidReason: string,
    blockedReasons: string[]
): GeoPoint | null {
    const hasLatitude = source[latitudeKey] !== undefined && source[latitudeKey] !== null;
    const hasLongitude = source[longitudeKey] !== undefined && source[longitudeKey] !== null;
    if (!hasLatitude && !hasLongitude) {
        return null;
    }
    const point = geoPoint(source[latitudeKey], source[longitudeKey]);
    if (!point) {
        blockedReasons.push(invalidReason);
    }
    return point;
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

function optionalUuid(value: unknown): string | null {
    const text = optionalString(value);
    return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
        ? text
        : null;
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

function optionalNonNegativeFinite(value: unknown): number | null {
    const parsed = optionalFinite(value);
    return parsed !== null && parsed >= 0 ? parsed : null;
}
