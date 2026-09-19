import type { FieldReportAdminContext } from "./field-report-evidence.js";
import { isFieldSurveySource, isAllowedAdminStatusTransition } from "./report-admin-status.js";

/** Field report kinds used by the review action matrix (not public report types). */
export const REPORT_REVIEW_KINDS = [
    "STOP_MOVED",
    "STOP_MISSING",
    "NEW_STOP",
    "WRONG_DATA",
    "ROUTE_ISSUE",
    "OTHER",
] as const;

export type ReportReviewKind = (typeof REPORT_REVIEW_KINDS)[number];

export const REPORT_REVIEW_ACTIONS = [
    "MOVE_STOP",
    "REMOVE_FROM_ROUTE",
    "CREATE_AND_INSERT_STOP",
    "UPDATE_STOP_DETAILS",
    "OPEN_ROUTE_EDITOR",
    "RESOLVE",
    "REJECT",
] as const;

export type ReportReviewActionCode = (typeof REPORT_REVIEW_ACTIONS)[number];

/** Canonical apply actions — server must load targets from trusted report data. */
export const REPORT_CANONICAL_APPLY_ACTIONS = [
    "MOVE_STOP",
    "REMOVE_FROM_ROUTE",
    "CREATE_AND_INSERT_STOP",
    "UPDATE_STOP_DETAILS",
] as const;

export type ReportCanonicalApplyAction = (typeof REPORT_CANONICAL_APPLY_ACTIONS)[number];

/** Statuses that may receive an apply action (OPEN maps to submitted). */
export const REPORT_APPLY_OPEN_STATUSES = ["submitted", "in_review"] as const;

export type ReportReviewGeoPoint = {
    latitude: number;
    longitude: number;
};

export type ReportReviewStopRef = {
    public_id: string;
    name: string | null;
    sequence: number | null;
};

export type ReportReviewMapStopRole = "previous" | "target" | "next" | "surrounding";

export type ReportReviewMapStop = {
    public_id: string;
    name: string | null;
    sequence: number | null;
    latitude: number;
    longitude: number;
    role: ReportReviewMapStopRole;
};

/** Local variant stop window for the evidence map — never a national dump. */
export type ReportReviewMapContext = {
    stops: ReportReviewMapStop[];
};

export type ReportReviewAllowedAction = {
    action: ReportReviewActionCode;
    enabled: boolean;
    disabledReason: string | null;
};

/**
 * Compact admin review projection. Omits raw canonicalSnapshot and free-text notes.
 * Proposed change text is derived only from structured report fields.
 */
export type ReportReview = {
    report_id: string;
    report_type: string;
    status: string;
    timestamp: string;
    kind: ReportReviewKind | null;
    route_code: string | null;
    variant_code: string | null;
    target_stop: ReportReviewStopRef | null;
    proposed_change: string | null;
    current_canonical_revision: string | null;
    field_snapshot_revision: string | null;
    coordinates: {
        current: ReportReviewGeoPoint | null;
        proposed: ReportReviewGeoPoint | null;
        observed: ReportReviewGeoPoint | null;
    };
    previous_stop: ReportReviewStopRef | null;
    next_stop: ReportReviewStopRef | null;
    map_context: ReportReviewMapContext | null;
    affected_route_count: number;
    allowedActions: ReportReviewAllowedAction[];
};

/** Default half-window of ordered stops loaded around the focus sequence. */
export const REPORT_REVIEW_MAP_WINDOW_RADIUS = 3;

export function labelReviewMapStops(input: {
    stops: Array<{
        public_id: string;
        name: string | null;
        sequence: number | null;
        latitude: number;
        longitude: number;
    }>;
    previousStopPublicId: string | null;
    targetStopPublicId: string | null;
    nextStopPublicId: string | null;
}): ReportReviewMapStop[] {
    return input.stops.map((stop) => {
        let role: ReportReviewMapStopRole = "surrounding";
        if (input.targetStopPublicId && stop.public_id === input.targetStopPublicId) {
            role = "target";
        } else if (input.previousStopPublicId && stop.public_id === input.previousStopPublicId) {
            role = "previous";
        } else if (input.nextStopPublicId && stop.public_id === input.nextStopPublicId) {
            role = "next";
        }
        return { ...stop, role };
    });
}

export type StructuredProposedStopDetails = {
    proposed_stop_name: string | null;
};

const REPORT_TYPE_TO_KIND: Record<string, ReportReviewKind> = {
    wrong_location: "STOP_MOVED",
    missing_item: "STOP_MISSING",
    new_stop: "NEW_STOP",
    wrong_info: "WRONG_DATA",
    transport_issue: "ROUTE_ISSUE",
    other_map_issue: "OTHER",
    // Tourism-only codes intentionally omitted — no automatic data mutation.
};

export function reviewKindForReportType(reportTypeCode: string): ReportReviewKind | null {
    return REPORT_TYPE_TO_KIND[reportTypeCode] ?? null;
}

/** Structured proposed stop-detail fields only — never free-text description/note. */
export function structuredProposedStopDetailsFromField(
    field: FieldReportAdminContext | null
): StructuredProposedStopDetails | null {
    const name = field?.proposed_stop_name?.trim() || null;
    if (!name) {
        return null;
    }
    return { proposed_stop_name: name };
}

export function proposedChangeSummary(input: {
    kind: ReportReviewKind | null;
    field: FieldReportAdminContext | null;
    structuredDetails: StructuredProposedStopDetails | null;
}): string | null {
    const { kind, field, structuredDetails } = input;
    if (!kind) {
        return null;
    }
    switch (kind) {
        case "STOP_MOVED": {
            const point = field?.proposed_location;
            if (!point) {
                return null;
            }
            return `Move stop to ${formatCoord(point.latitude)}, ${formatCoord(point.longitude)}`;
        }
        case "STOP_MISSING":
            return field?.stop_public_id ? "Remove stop from this route variant" : null;
        case "NEW_STOP": {
            const name = structuredDetails?.proposed_stop_name ?? field?.proposed_stop_name;
            if (!name || !field?.proposed_location) {
                return null;
            }
            const after =
                field.previous_stop_sequence != null
                    ? ` after sequence ${field.previous_stop_sequence}`
                    : "";
            return `Create and insert stop "${name}"${after}`;
        }
        case "WRONG_DATA":
            return structuredDetails
                ? `Update stop details (proposed name: ${structuredDetails.proposed_stop_name})`
                : null;
        case "ROUTE_ISSUE":
            return field?.route_public_id ? "Open route editor" : null;
        case "OTHER":
            return null;
        default:
            return null;
    }
}

export function buildAllowedActions(input: {
    kind: ReportReviewKind | null;
    statusCode: string;
    sourceCode: string | null | undefined;
    field: FieldReportAdminContext | null;
    structuredDetails: StructuredProposedStopDetails | null;
    proposedChange: string | null;
}): ReportReviewAllowedAction[] {
    const actions: ReportReviewAllowedAction[] = [];
    const { kind, field, structuredDetails, proposedChange } = input;
    const statusOpen = (REPORT_APPLY_OPEN_STATUSES as readonly string[]).includes(input.statusCode);

    if (kind === "STOP_MOVED") {
        const evidence = Boolean(field?.stop_public_id && field.proposed_location && proposedChange);
        actions.push(
            statusOpen
                ? canonicalAction(
                      "MOVE_STOP",
                      evidence,
                      !field?.stop_public_id
                          ? "Target stop is missing from report evidence"
                          : !field.proposed_location
                            ? "Proposed coordinates are missing from report evidence"
                            : "Proposed change is incomplete"
                  )
                : {
                      action: "MOVE_STOP",
                      enabled: false,
                      disabledReason: `Cannot apply while the report is '${input.statusCode}'`,
                  }
        );
    }
    if (kind === "STOP_MISSING") {
        const evidence = Boolean(field?.stop_public_id && field.variant_public_id && proposedChange);
        actions.push(
            statusOpen
                ? canonicalAction(
                      "REMOVE_FROM_ROUTE",
                      evidence,
                      !field?.stop_public_id
                          ? "Target stop is missing from report evidence"
                          : !field.variant_public_id
                            ? "Route variant is missing from report evidence"
                            : "Proposed change is incomplete"
                  )
                : {
                      action: "REMOVE_FROM_ROUTE",
                      enabled: false,
                      disabledReason: `Cannot apply while the report is '${input.statusCode}'`,
                  }
        );
    }
    if (kind === "NEW_STOP") {
        const evidence = Boolean(
            field?.variant_public_id &&
                field.previous_stop_public_id &&
                field.proposed_stop_name &&
                field.proposed_location &&
                proposedChange
        );
        actions.push(
            statusOpen
                ? canonicalAction(
                      "CREATE_AND_INSERT_STOP",
                      evidence,
                      !field?.variant_public_id
                          ? "Route variant is missing from report evidence"
                          : !field.previous_stop_public_id
                            ? "Previous stop is missing from report evidence"
                            : !field.proposed_stop_name
                              ? "Proposed stop name is missing from report evidence"
                              : !field.proposed_location
                                ? "Proposed coordinates are missing from report evidence"
                                : "Proposed change is incomplete"
                  )
                : {
                      action: "CREATE_AND_INSERT_STOP",
                      enabled: false,
                      disabledReason: `Cannot apply while the report is '${input.statusCode}'`,
                  }
        );
    }
    if (kind === "WRONG_DATA") {
        const evidence = Boolean(field?.stop_public_id && structuredDetails && proposedChange);
        actions.push(
            statusOpen
                ? canonicalAction(
                      "UPDATE_STOP_DETAILS",
                      evidence,
                      !field?.stop_public_id
                          ? "Target stop is missing from report evidence"
                          : !structuredDetails
                            ? "No structured proposed stop details in this report"
                            : "Proposed change is incomplete"
                  )
                : {
                      action: "UPDATE_STOP_DETAILS",
                      enabled: false,
                      disabledReason: `Cannot apply while the report is '${input.statusCode}'`,
                  }
        );
    }
    if (kind === "ROUTE_ISSUE") {
        const routeId = field?.route_public_id;
        actions.push({
            action: "OPEN_ROUTE_EDITOR",
            enabled: Boolean(routeId) && statusOpen,
            disabledReason: !routeId
                ? "Route public ID is missing from report evidence"
                : statusOpen
                  ? null
                  : `Cannot apply while the report is '${input.statusCode}'`,
        });
    }

    const canResolve = isAllowedAdminStatusTransition(input.statusCode, "resolved", input.sourceCode);
    const canReject = isAllowedAdminStatusTransition(input.statusCode, "rejected", input.sourceCode);
    actions.push({
        action: "RESOLVE",
        enabled: canResolve,
        disabledReason: canResolve
            ? null
            : `Cannot resolve from status '${input.statusCode}'`,
    });
    actions.push({
        action: "REJECT",
        enabled: canReject,
        disabledReason: canReject ? null : `Cannot reject from status '${input.statusCode}'`,
    });

    return actions;
}

export function toReportReview(input: {
    reportId: string;
    reportTypeCode: string;
    statusCode: string;
    sourceCode: string | null | undefined;
    timestamp: string;
    field: FieldReportAdminContext | null;
    currentCanonical: ReportReviewGeoPoint | null;
    affectedRouteCount: number;
    previousStop: ReportReviewStopRef | null;
    nextStop: ReportReviewStopRef | null;
    mapContext?: ReportReviewMapContext | null;
}): ReportReview | null {
    if (!isFieldSurveySource(input.sourceCode)) {
        return null;
    }
    const field = input.field;
    const kind = reviewKindForReportType(input.reportTypeCode);
    const structuredDetails =
        kind === "WRONG_DATA" || kind === "NEW_STOP"
            ? structuredProposedStopDetailsFromField(field)
            : null;
    const proposedChange = proposedChangeSummary({ kind, field, structuredDetails });
    const targetStop = targetStopRef(kind, field);

    return {
        report_id: input.reportId,
        report_type: input.reportTypeCode,
        status: input.statusCode,
        timestamp: input.timestamp,
        kind,
        route_code: field?.route_code ?? null,
        variant_code: field?.variant_code ?? null,
        target_stop: targetStop,
        proposed_change: proposedChange,
        current_canonical_revision: field?.current_snapshot_revision ?? null,
        field_snapshot_revision: field?.snapshot_revision ?? null,
        coordinates: {
            current: input.currentCanonical,
            proposed: field?.proposed_location ?? null,
            observed: field?.observed_location
                ? {
                      latitude: field.observed_location.latitude,
                      longitude: field.observed_location.longitude,
                  }
                : null,
        },
        previous_stop: input.previousStop,
        next_stop: input.nextStop,
        map_context: input.mapContext ?? null,
        affected_route_count: input.affectedRouteCount,
        allowedActions: buildAllowedActions({
            kind,
            statusCode: input.statusCode,
            sourceCode: input.sourceCode,
            field,
            structuredDetails,
            proposedChange,
        }),
    };
}

function targetStopRef(
    kind: ReportReviewKind | null,
    field: FieldReportAdminContext | null
): ReportReviewStopRef | null {
    if (!field) {
        return null;
    }
    if (kind === "NEW_STOP") {
        if (!field.previous_stop_public_id) {
            return null;
        }
        return {
            public_id: field.previous_stop_public_id,
            name: field.stop_name,
            sequence: field.previous_stop_sequence ?? field.stop_sequence,
        };
    }
    if (!field.stop_public_id) {
        return null;
    }
    return {
        public_id: field.stop_public_id,
        name: field.stop_name,
        sequence: field.stop_sequence,
    };
}

function canonicalAction(
    action: ReportCanonicalApplyAction,
    evidenceReady: boolean,
    missingEvidenceReason: string
): ReportReviewAllowedAction {
    if (!evidenceReady) {
        return {
            action,
            enabled: false,
            disabledReason: missingEvidenceReason,
        };
    }
    return {
        action,
        enabled: true,
        disabledReason: null,
    };
}

function formatCoord(value: number): string {
    return value.toFixed(6);
}

export function isReportCanonicalApplyAction(
    action: string
): action is ReportCanonicalApplyAction {
    return (REPORT_CANONICAL_APPLY_ACTIONS as readonly string[]).includes(action);
}
