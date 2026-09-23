import type {
    AdminReportDetail,
    ReportReview,
    ReportReviewKind,
    ReportReviewMapStop,
} from "./types";

export const SURVEY_OUTSIDE_MAP_MESSAGE = "Survey location is outside this map area";
export const EVIDENCE_MAP_MAX_AUTO_ZOOM = 17.5;
/** Observed GPS beyond this multiple of the primary span is treated as an outlier. */
export const OBSERVED_OUTLIER_SPAN_FACTOR = 2.5;
export const OBSERVED_OUTLIER_MIN_METERS = 180;

export type EvidenceMapLngLat = {
    longitude: number;
    latitude: number;
};

export type EvidenceMapMarkerRole =
    | "canonical"
    | "proposed"
    | "observed"
    | "removal"
    | "previous"
    | "next"
    | "surrounding"
    | "target";

export type EvidenceMapMarker = EvidenceMapLngLat & {
    id: string;
    role: EvidenceMapMarkerRole;
    label: string;
    sequence: number | null;
    /** Include in default camera fit (excludes far GPS outliers). */
    fitDefault: boolean;
};

export type EvidenceMapLineKind = "before" | "after" | "insert";

export type EvidenceMapLine = {
    id: string;
    kind: EvidenceMapLineKind;
    coordinates: [number, number][];
};

export type EvidenceMapDistance = {
    label: string;
    meters: number;
};

export type EvidenceMapModel = {
    markers: EvidenceMapMarker[];
    lines: EvidenceMapLine[];
    distance: EvidenceMapDistance | null;
    empty: boolean;
    observedIsOutlier: boolean;
};

export function isValidEvidenceCoordinate(
    point: { latitude?: number | null; longitude?: number | null } | null | undefined
): point is EvidenceMapLngLat {
    if (!point) return false;
    const { latitude, longitude } = point;
    return (
        typeof latitude === "number" &&
        typeof longitude === "number" &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        Math.abs(latitude) <= 90 &&
        Math.abs(longitude) <= 180
    );
}

export function haversineMeters(a: EvidenceMapLngLat, b: EvidenceMapLngLat): number {
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

export function formatEvidenceDistanceMeters(meters: number): string {
    if (!Number.isFinite(meters)) return "Distance unavailable";
    if (meters < 10) return `${meters.toFixed(1)} m`;
    return `${Math.round(meters)} m`;
}

function pointSpanMeters(points: EvidenceMapLngLat[]): number {
    if (points.length < 2) return 0;
    let max = 0;
    for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
            max = Math.max(max, haversineMeters(points[i]!, points[j]!));
        }
    }
    return max;
}

function centroid(points: EvidenceMapLngLat[]): EvidenceMapLngLat | null {
    if (points.length === 0) return null;
    const sum = points.reduce(
        (acc, point) => ({
            latitude: acc.latitude + point.latitude,
            longitude: acc.longitude + point.longitude,
        }),
        { latitude: 0, longitude: 0 }
    );
    return {
        latitude: sum.latitude / points.length,
        longitude: sum.longitude / points.length,
    };
}

function findContextStop(
    stops: ReportReviewMapStop[],
    role: ReportReviewMapStop["role"]
): ReportReviewMapStop | null {
    return stops.find((stop) => stop.role === role) ?? null;
}

function lineFromStops(
    id: string,
    kind: EvidenceMapLineKind,
    stops: Array<EvidenceMapLngLat | null | undefined>
): EvidenceMapLine | null {
    const coordinates: [number, number][] = [];
    for (const stop of stops) {
        if (!isValidEvidenceCoordinate(stop)) continue;
        coordinates.push([stop.longitude, stop.latitude]);
    }
    if (coordinates.length < 2) return null;
    return { id, kind, coordinates };
}

function buildDistance(
    kind: ReportReviewKind | null,
    current: EvidenceMapLngLat | null,
    proposed: EvidenceMapLngLat | null,
    observed: EvidenceMapLngLat | null,
    target: EvidenceMapLngLat | null
): EvidenceMapDistance | null {
    if (kind === "STOP_MOVED" && current && proposed) {
        return {
            label: "Current → proposed",
            meters: haversineMeters(current, proposed),
        };
    }
    if (kind === "NEW_STOP" && observed && proposed) {
        return {
            label: "Observed → proposed",
            meters: haversineMeters(observed, proposed),
        };
    }
    if (observed && target) {
        return {
            label: "Observed → target",
            meters: haversineMeters(observed, target),
        };
    }
    if (observed && current) {
        return {
            label: "Observed → current",
            meters: haversineMeters(observed, current),
        };
    }
    return null;
}

/**
 * Transform trusted report review + local map_context into map scene data.
 * Pure — no MapLibre, no network.
 */
export function buildEvidenceMapModel(
    report: Pick<AdminReportDetail, "source_code" | "review" | "canonical_target" | "field">,
    authoritativeDistances?: {
        observedToCurrentMetres: number | null;
        observedToProposedMetres: number | null;
    }
): EvidenceMapModel {
    if (report.source_code !== "field_survey") {
        return { markers: [], lines: [], distance: null, empty: true, observedIsOutlier: false };
    }

    const review: ReportReview | null = report.review;
    const kind = review?.kind ?? null;
    const contextStops = (review?.map_context?.stops ?? []).filter((stop) =>
        isValidEvidenceCoordinate(stop)
    );

    const current = isValidEvidenceCoordinate(review?.coordinates.current)
        ? review!.coordinates.current
        : isValidEvidenceCoordinate(report.canonical_target)
          ? report.canonical_target
          : null;
    const proposed = isValidEvidenceCoordinate(review?.coordinates.proposed)
        ? review!.coordinates.proposed
        : isValidEvidenceCoordinate(report.field?.proposed_location)
          ? report.field!.proposed_location
          : null;
    const observed = isValidEvidenceCoordinate(review?.coordinates.observed)
        ? review!.coordinates.observed
        : isValidEvidenceCoordinate(report.field?.observed_location)
          ? {
                latitude: report.field!.observed_location!.latitude,
                longitude: report.field!.observed_location!.longitude,
            }
          : null;

    const previous = findContextStop(contextStops, "previous");
    const next = findContextStop(contextStops, "next");
    const targetStop = findContextStop(contextStops, "target");
    const targetPoint: EvidenceMapLngLat | null = targetStop
        ? { latitude: targetStop.latitude, longitude: targetStop.longitude }
        : current;

    const markers: EvidenceMapMarker[] = [];

    for (const stop of contextStops) {
        if (stop.role === "surrounding") {
            markers.push({
                id: `surrounding:${stop.public_id}`,
                role: "surrounding",
                label: stop.sequence != null ? String(stop.sequence) : stop.name ?? "Stop",
                sequence: stop.sequence,
                latitude: stop.latitude,
                longitude: stop.longitude,
                fitDefault: true,
            });
            continue;
        }
        if (stop.role === "previous") {
            markers.push({
                id: `previous:${stop.public_id}`,
                role: "previous",
                label: stop.sequence != null ? String(stop.sequence) : "Prev",
                sequence: stop.sequence,
                latitude: stop.latitude,
                longitude: stop.longitude,
                fitDefault: true,
            });
        } else if (stop.role === "next") {
            markers.push({
                id: `next:${stop.public_id}`,
                role: "next",
                label: stop.sequence != null ? String(stop.sequence) : "Next",
                sequence: stop.sequence,
                latitude: stop.latitude,
                longitude: stop.longitude,
                fitDefault: true,
            });
        } else if (stop.role === "target" && kind === "STOP_MISSING") {
            markers.push({
                id: `removal:${stop.public_id}`,
                role: "removal",
                label: stop.sequence != null ? String(stop.sequence) : "Remove",
                sequence: stop.sequence,
                latitude: stop.latitude,
                longitude: stop.longitude,
                fitDefault: true,
            });
        } else if (stop.role === "target") {
            // Target geometry is represented by the canonical/current marker below.
            continue;
        }
    }

    if (current && kind !== "STOP_MISSING") {
        markers.push({
            id: "canonical",
            role: "canonical",
            label: "Current",
            sequence: review?.target_stop?.sequence ?? null,
            latitude: current.latitude,
            longitude: current.longitude,
            fitDefault: true,
        });
    }

    if (proposed) {
        markers.push({
            id: "proposed",
            role: "proposed",
            label: kind === "NEW_STOP" ? "New" : "Proposed",
            sequence: null,
            latitude: proposed.latitude,
            longitude: proposed.longitude,
            fitDefault: true,
        });
    }

    const primaryFitPoints = markers.filter((marker) => marker.fitDefault);
    const primarySpan = pointSpanMeters(primaryFitPoints);
    const primaryCenter = centroid(primaryFitPoints);
    let observedIsOutlier = false;
    if (observed && primaryCenter && primaryFitPoints.length > 0) {
        const threshold = Math.max(
            OBSERVED_OUTLIER_MIN_METERS,
            primarySpan * OBSERVED_OUTLIER_SPAN_FACTOR
        );
        observedIsOutlier = haversineMeters(observed, primaryCenter) > threshold;
    } else if (observed && primaryFitPoints.length === 0) {
        observedIsOutlier = false;
    }

    if (observed) {
        markers.push({
            id: "observed",
            role: "observed",
            label: "GPS",
            sequence: null,
            latitude: observed.latitude,
            longitude: observed.longitude,
            fitDefault: !observedIsOutlier,
        });
    }

    const lines: EvidenceMapLine[] = [];
    if (kind === "STOP_MISSING") {
        const before = lineFromStops("before-removal", "before", [previous, targetPoint, next]);
        if (before) lines.push(before);
        const after = lineFromStops("after-removal", "after", [previous, next]);
        if (after) lines.push(after);
    } else if (kind === "NEW_STOP") {
        const insert = lineFromStops("insert-new", "insert", [previous, proposed, next]);
        if (insert) lines.push(insert);
    } else if (previous || next || targetPoint || current) {
        const segment = lineFromStops("route-segment", "before", [
            previous,
            kind === "STOP_MOVED" ? current : targetPoint,
            next,
        ]);
        if (segment) lines.push(segment);
        if (kind === "STOP_MOVED" && current && proposed) {
            const move = lineFromStops("move-preview", "after", [current, proposed]);
            if (move) lines.push(move);
        }
    }

    const distance =
        authoritativeDistances === undefined
            ? buildDistance(kind, current, proposed, observed, targetPoint)
            : authoritativeDistances.observedToProposedMetres !== null
              ? {
                    label: "Observed → proposed",
                    meters: authoritativeDistances.observedToProposedMetres,
                }
              : authoritativeDistances.observedToCurrentMetres !== null
                ? {
                      label: "Observed → current",
                      meters: authoritativeDistances.observedToCurrentMetres,
                  }
                : null;

    return {
        markers,
        lines,
        distance,
        empty: markers.length === 0 && lines.length === 0,
        observedIsOutlier,
    };
}

export function evidenceMapFitPoints(
    model: EvidenceMapModel,
    includeObservedOutlier: boolean
): EvidenceMapLngLat[] {
    return model.markers
        .filter((marker) => marker.fitDefault || (includeObservedOutlier && marker.role === "observed"))
        .map((marker) => ({ latitude: marker.latitude, longitude: marker.longitude }));
}
