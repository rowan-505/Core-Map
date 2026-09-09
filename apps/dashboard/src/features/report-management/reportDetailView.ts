import type {
    AdminReportDetail,
    ReportReview,
    ReportReviewActionCode,
    ReportReviewAllowedAction,
} from "./types";

/** Copy shown when the field snapshot no longer matches live map data. */
export const STALE_SNAPSHOT_WARNING =
    "Map data changed after this survey. Review the current stop before applying this report.";

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

export type ReportDetailActionModel = {
    primary: ReportDetailPrimaryAction | null;
    resolve: ReportReviewAllowedAction | null;
    reject: ReportReviewAllowedAction | null;
    stale: boolean;
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
                enabled: !stale || Boolean(field?.route_public_id),
                disabledReason: null,
                mode: "navigate",
            };
        }
    } else if (preferredCode && preferredState) {
        const applyEnabled = preferredState.enabled && !stale;
        primary = {
            action: preferredCode,
            label: PRIMARY_ACTION_LABELS[preferredCode],
            enabled: applyEnabled,
            disabledReason: !preferredState.enabled
                ? preferredState.disabledReason
                : stale
                  ? STALE_SNAPSHOT_WARNING
                  : null,
            mode: preferredCode === "OPEN_ROUTE_EDITOR" ? "navigate" : "apply",
        };
    }

    return {
        primary,
        resolve,
        reject,
        stale,
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
