import { fieldRouteEditorHref, fieldStopEditorHref } from "./fieldReportLinks";
import type {
    AdminReportDetail,
    NormalizedAdminReportDetail,
    ReportReview,
    ReportReviewActionCode,
    ReportReviewAllowedAction,
} from "./types";

/** Presentation adapter for existing dashboard cards; advisory actions stay separate. */
export function toLegacyReportDetailView(
    detail: NormalizedAdminReportDetail
): AdminReportDetail {
    const { report, routeContext, comparison, observer, workflow } = detail;
    const isField = report.sourceCode === "field_survey";
    return {
        public_id: report.publicId,
        is_anonymous: report.isAnonymous,
        eligible_for_points: report.eligibleForPoints,
        report_type: { code: report.reportTypeCode, name: report.reportTypeCode },
        status: { code: report.statusCode, name: report.statusCode },
        reason_code: report.reasonCode,
        target_entity_type: report.targetEntityType,
        target_entity_id: report.targetEntityId,
        target_public_id: report.targetPublicId,
        title: report.title,
        description: report.description,
        latitude: report.reportedCoordinates?.latitude ?? null,
        longitude: report.reportedCoordinates?.longitude ?? null,
        admin_area_id: report.adminAreaId,
        admin_area_name: report.adminAreaName,
        priority: report.priority,
        confidence_score: report.confidenceScore,
        admin_note: workflow.adminNote,
        reviewed_at: workflow.reviewedAt,
        reward_granted_at: report.rewardGrantedAt,
        created_at: report.createdAt,
        updated_at: report.updatedAt,
        anonymous_id: report.anonymousId,
        author:
            report.reporterPublicId && report.reporterEmail
                ? {
                      public_id: report.reporterPublicId,
                      display_name: report.reporterName,
                      email: report.reporterEmail,
                  }
                : null,
        source_code: report.sourceCode,
        observed_at: report.observedAt,
        location_accuracy_m: observer?.accuracyMetres ?? null,
        field: isField
            ? {
                  route_code: routeContext?.route?.code ?? null,
                  route_public_id: routeContext?.route?.publicId ?? null,
                  variant_code: routeContext?.variant?.code ?? null,
                  variant_public_id: routeContext?.variant?.publicId ?? null,
                  origin_name: routeContext?.variant?.originName ?? null,
                  destination_name: routeContext?.variant?.destinationName ?? null,
                  stop_public_id: detail.resolvedTarget.stopPublicId,
                  stop_name:
                      routeContext?.currentStop?.name ??
                      routeContext?.insertion?.afterStop?.name ??
                      null,
                  stop_sequence: detail.resolvedTarget.stopSequence,
                  previous_stop_public_id:
                      routeContext?.previousStop?.publicId ??
                      routeContext?.insertion?.afterStop?.publicId ??
                      null,
                  previous_stop_sequence:
                      routeContext?.previousStop?.sequence ??
                      routeContext?.insertion?.afterStop?.sequence ??
                      null,
                  next_stop_public_id:
                      routeContext?.nextStop?.publicId ??
                      routeContext?.insertion?.beforeStop?.publicId ??
                      null,
                  proposed_stop_name: comparison.proposed?.name ?? null,
                  location_source: comparison.proposedLocationSource,
                  snapshot_revision: comparison.snapshotRevision,
                  snapshot_stale: comparison.isStale === true,
                  current_snapshot_revision: comparison.currentRevision,
                  survey_session_public_id: null,
                  survey_session_status: null,
                  canonical_snapshot: null,
                  observed_location: observer
                      ? {
                            latitude: observer.coordinates.latitude,
                            longitude: observer.coordinates.longitude,
                            accuracy_m: observer.accuracyMetres,
                        }
                      : null,
                  proposed_location: comparison.proposed?.coordinates ?? null,
              }
            : null,
        canonical_target: comparison.current?.coordinates ?? null,
        distance_m: observer?.distanceToCurrentStopMetres ?? null,
        media_count: detail.evidence.media.length,
        review: null,
        status_events: workflow.statusEvents.map((event) => ({
            old_status_code: event.oldStatusCode,
            new_status_code: event.newStatusCode,
            actor_display_name: event.actorDisplayName,
            note: event.note,
            created_at: event.createdAt,
        })),
        followups: workflow.followups.map((followup) => ({
            actor_type: followup.actorType,
            actor_display_name: followup.actorDisplayName,
            message: followup.message,
            created_at: followup.createdAt,
        })),
        media: detail.evidence.media,
    };
}

/** Copy shown when the field snapshot no longer matches live map data. */
export const STALE_SNAPSHOT_WARNING =
    "Map data changed after this survey. Review the current stop before applying this report.";

/** Checkbox label required before applying a stale report. */
export const STALE_APPLY_ACK_LABEL =
    "I reviewed the current map and still want to apply this report.";

/** Shown when no structured apply action is available. */
export const NO_DIRECT_ACTION_MESSAGE = "This report needs manual editing.";

/** Clarifies Resolve without change. */
export const RESOLVE_WITHOUT_CHANGE_HINT =
    "Closes the report without changing map data.";

const PRIMARY_BY_KIND: Record<string, ReportReviewActionCode> = {
    STOP_MOVED: "MOVE_STOP",
    STOP_MISSING: "REMOVE_FROM_ROUTE",
    NEW_STOP: "CREATE_AND_INSERT_STOP",
    WRONG_DATA: "UPDATE_STOP_DETAILS",
    ROUTE_ISSUE: "OPEN_ROUTE_EDITOR",
};

export const PRIMARY_ACTION_LABELS: Record<ReportReviewActionCode, string> = {
    MOVE_STOP: "Apply stop move",
    REMOVE_FROM_ROUTE: "Remove from route",
    CREATE_AND_INSERT_STOP: "Create and insert stop",
    UPDATE_STOP_DETAILS: "Update stop details",
    OPEN_ROUTE_EDITOR: "Open route editor",
    RESOLVE: "Resolve without change",
    REJECT: "Reject",
};

export type ReportDetailPrimaryAction = {
    action: ReportReviewActionCode;
    label: string;
    enabled: boolean;
    disabledReason: string | null;
    /** navigate = open route editor client-side; apply = POST /apply */
    mode: "apply" | "navigate";
};

export type ReportDetailManualEditor = {
    href: string;
    label: string;
};

export type ReportDetailActionModel = {
    primary: ReportDetailPrimaryAction | null;
    resolve: ReportReviewAllowedAction | null;
    reject: ReportReviewAllowedAction | null;
    stale: boolean;
    /** Stale apply stays enabled, but UI must collect this acknowledgment first. */
    requiresStaleAck: boolean;
    manualEditor: ReportDetailManualEditor | null;
    noDirectActionMessage: string | null;
    expectedCanonicalRevision: string | null;
};
function findAction(
    actions: ReportReviewAllowedAction[],
    code: ReportReviewActionCode
): ReportReviewAllowedAction | null {
    return actions.find((item) => item.action === code) ?? null;
}

function isUnsupportedStructuredChange(
    review: ReportReview,
    preferred: ReportReviewActionCode | null,
    preferredState: ReportReviewAllowedAction | null
): boolean {
    if (review.kind === "OTHER") {
        return true;
    }
    if (review.kind === "WRONG_DATA" && preferred === "UPDATE_STOP_DETAILS") {
        return !preferredState?.enabled;
    }
    return false;
}

function buildManualEditorLink(
    field: AdminReportDetail["field"],
    primary: ReportDetailPrimaryAction | null
): ReportDetailManualEditor | null {
    if (field?.stop_public_id) {
        return {
            href: fieldStopEditorHref(field.stop_public_id),
            label: "Open stop editor",
        };
    }
    if (field?.route_public_id) {
        if (primary?.mode === "navigate" && primary.action === "OPEN_ROUTE_EDITOR") {
            return null;
        }
        return {
            href: fieldRouteEditorHref(field.route_public_id),
            label: "Open route editor",
        };
    }
    return null;
}

/**
 * Presentation-only action panel model from trusted API `review.allowedActions`.
 * Does not invent permissions beyond what the API returned.
 */
export function buildReportDetailActionModel(
    report: Pick<AdminReportDetail, "field" | "review" | "source_code">
): ReportDetailActionModel {
    const review = report.review;
    const field = report.field;
    const stale = Boolean(field?.snapshot_stale);
    const expectedCanonicalRevision =
        review?.current_canonical_revision ??
        field?.current_snapshot_revision ??
        field?.snapshot_revision ??
        null;

    if (!review || report.source_code !== "field_survey") {
        return {
            primary: null,
            resolve: null,
            reject: null,
            stale,
            requiresStaleAck: false,
            manualEditor: buildManualEditorLink(field, null),
            noDirectActionMessage: null,
            expectedCanonicalRevision,
        };
    }

    const resolve = findAction(review.allowedActions, "RESOLVE");
    const reject = findAction(review.allowedActions, "REJECT");
    const preferredCode = review.kind ? (PRIMARY_BY_KIND[review.kind] ?? null) : null;
    const preferredState = preferredCode ? findAction(review.allowedActions, preferredCode) : null;
    const openRoute = findAction(review.allowedActions, "OPEN_ROUTE_EDITOR");
    const canNavigateRoute = Boolean(field?.route_public_id);

    let primary: ReportDetailPrimaryAction | null = null;

    if (review.kind === "ROUTE_ISSUE") {
        primary = {
            action: "OPEN_ROUTE_EDITOR",
            label: PRIMARY_ACTION_LABELS.OPEN_ROUTE_EDITOR,
            enabled: Boolean(openRoute?.enabled ?? canNavigateRoute),
            disabledReason:
                openRoute?.disabledReason ??
                (canNavigateRoute ? null : "Route is missing from report evidence"),
            mode: "navigate",
        };
    } else if (isUnsupportedStructuredChange(review, preferredCode, preferredState)) {
        if (canNavigateRoute) {
            primary = {
                action: "OPEN_ROUTE_EDITOR",
                label: PRIMARY_ACTION_LABELS.OPEN_ROUTE_EDITOR,
                enabled: Boolean(field?.route_public_id),
                disabledReason: null,
                mode: "navigate",
            };
        }
    } else if (preferredCode && preferredState) {
        // Stale reports stay clickable; the panel requires an acknowledgment checkbox.
        primary = {
            action: preferredCode,
            label: PRIMARY_ACTION_LABELS[preferredCode],
            enabled: preferredState.enabled,
            disabledReason: preferredState.enabled ? null : preferredState.disabledReason,
            mode: preferredCode === "OPEN_ROUTE_EDITOR" ? "navigate" : "apply",
        };
    }

    const requiresStaleAck = Boolean(stale && primary?.mode === "apply" && primary.enabled);

    return {
        primary,
        resolve,
        reject,
        stale,
        requiresStaleAck,
        manualEditor: buildManualEditorLink(field, primary),
        noDirectActionMessage: primary == null ? NO_DIRECT_ACTION_MESSAGE : null,
        expectedCanonicalRevision,
    };
}
export type ReportDetailKeyFacts = {
    routeVariant: string;
    targetStop: string;
    reportTime: string;
    proposedChange: string;
};

export function buildReportDetailKeyFacts(
    report: AdminReportDetail,
    formatDateTime: (value: string | null) => string
): ReportDetailKeyFacts {
    const review = report.review;
    const field = report.field;
    const route = review?.route_code ?? field?.route_code ?? "—";
    const variant = review?.variant_code ?? field?.variant_code ?? null;
    const routeVariant = variant ? `${route} · ${variant}` : route;

    let targetStop = "—";
    if (review?.target_stop) {
        const name = review.target_stop.name ?? review.target_stop.public_id;
        targetStop =
            review.target_stop.sequence != null ? `${name} (#${review.target_stop.sequence})` : name;
    } else if (review?.kind === "NEW_STOP" && review.previous_stop) {
        const name = review.previous_stop.name ?? review.previous_stop.public_id;
        targetStop = `After ${name}`;
    } else if (field?.stop_name || field?.stop_public_id) {
        targetStop = field.stop_name ?? field.stop_public_id ?? "—";
    } else if (field?.proposed_stop_name) {
        targetStop = field.proposed_stop_name;
    }

    return {
        routeVariant,
        targetStop,
        reportTime: formatDateTime(report.observed_at ?? report.created_at),
        proposedChange: review?.proposed_change ?? "—",
    };
}

export type ComparisonSide = {
    label: string;
    value: string;
};

export function buildReportDetailComparison(report: AdminReportDetail): {
    before: ComparisonSide;
    after: ComparisonSide;
    empty: boolean;
} | null {
    if (report.source_code !== "field_survey" || !report.review) {
        return null;
    }
    const { coordinates, kind, proposed_change, target_stop } = report.review;
    const formatPoint = (point: { latitude: number; longitude: number } | null) =>
        point ? `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}` : null;

    if (kind === "STOP_MOVED") {
        return {
            before: {
                label: "Current stop location",
                value: formatPoint(coordinates.current) ?? "—",
            },
            after: {
                label: "Proposed location",
                value: formatPoint(coordinates.proposed) ?? "—",
            },
            empty: !coordinates.current && !coordinates.proposed,
        };
    }
    if (kind === "STOP_MISSING") {
        return {
            before: {
                label: "Stop on this variant",
                value: target_stop?.name ?? target_stop?.public_id ?? "—",
            },
            after: {
                label: "After apply",
                value: "Removed from this variant only",
            },
            empty: false,
        };
    }
    if (kind === "NEW_STOP") {
        return {
            before: {
                label: "Insert after",
                value: report.review.previous_stop?.name ?? report.review.previous_stop?.public_id ?? "—",
            },
            after: {
                label: "New stop",
                value: report.field?.proposed_stop_name ?? proposed_change ?? "—",
            },
            empty: false,
        };
    }
    if (kind === "WRONG_DATA") {
        return {
            before: {
                label: "Current stop",
                value: target_stop?.name ?? target_stop?.public_id ?? "—",
            },
            after: {
                label: "Proposed change",
                value: proposed_change ?? "—",
            },
            empty: !proposed_change,
        };
    }
    if (kind === "ROUTE_ISSUE" || kind === "OTHER") {
        return {
            before: {
                label: "Current",
                value: report.review.route_code ?? "—",
            },
            after: {
                label: "Proposed change",
                value: proposed_change ?? "Manual review",
            },
            empty: !proposed_change,
        };
    }
    return {
        before: { label: "Before", value: "—" },
        after: { label: "After", value: proposed_change ?? "—" },
        empty: true,
    };
}
