import {
    PRIMARY_ACTION_LABELS,
    STALE_SNAPSHOT_WARNING,
    buildReportDetailKeyFacts,
} from "./reportDetailView";
import { formatEvidenceDistanceMeters, haversineMeters, isValidEvidenceCoordinate } from "./evidenceMapModel";
import type {
    AdminReportDetail,
    ReportApplyResult,
    ReportReviewActionCode,
} from "./types";

export const MAP_DATA_CHANGED_MESSAGE =
    "Map data changed. Review the updated comparison.";

export type ApplyConfirmationSummary = {
    action: ReportReviewActionCode;
    actionLabel: string;
    target: string;
    oldValue: string;
    proposedValue: string;
    changeDetail: string | null;
    affectedVariantsLabel: string;
    tone: "default" | "danger";
    confirmLabel: string;
    /** Set when applying despite a stale field snapshot. */
    staleWarning: string | null;
};

export type ApplyResultSummary = {
    action: ReportReviewActionCode;
    actionLabel: string;
    statusLabel: string;
    detail: string;
    toastMessage: string;
};

export type ApplyFlowPhase = "idle" | "confirming" | "submitting" | "succeeded";

export type ApplyFlowState = {
    phase: ApplyFlowPhase;
    confirmation: ApplyConfirmationSummary | null;
    result: ApplyResultSummary | null;
    conflictNotice: string | null;
    error: string | null;
    toast: string | null;
};

export function createApplyFlowState(): ApplyFlowState {
    return {
        phase: "idle",
        confirmation: null,
        result: null,
        conflictNotice: null,
        error: null,
        toast: null,
    };
}

/** Open confirmation for an allowed apply action. No-op when unavailable. */
export function openApplyConfirmation(
    state: ApplyFlowState,
    summary: ApplyConfirmationSummary | null
): ApplyFlowState {
    if (!summary) {
        return {
            ...state,
            error: "That action is not available for this report.",
            confirmation: null,
            phase: "idle",
        };
    }
    if (state.phase === "submitting") {
        return state;
    }
    return {
        ...state,
        phase: "confirming",
        confirmation: summary,
        error: null,
        conflictNotice: null,
    };
}

export function cancelApplyConfirmation(state: ApplyFlowState): ApplyFlowState {
    if (state.phase === "submitting") {
        return state;
    }
    return {
        ...state,
        phase: "idle",
        confirmation: null,
    };
}

/** Begin submit. Returns null when a submit is already in flight (duplicate click). */
export function beginApplySubmit(state: ApplyFlowState): ApplyFlowState | null {
    if (state.phase === "submitting" || !state.confirmation) {
        return null;
    }
    return {
        ...state,
        phase: "submitting",
        error: null,
    };
}

export function completeApplySuccess(
    state: ApplyFlowState,
    result: ApplyResultSummary
): ApplyFlowState {
    return {
        phase: "succeeded",
        confirmation: null,
        result,
        conflictNotice: null,
        error: null,
        toast: result.toastMessage,
    };
}

export function completeApplyConflict(state: ApplyFlowState): ApplyFlowState {
    return {
        ...state,
        phase: "idle",
        confirmation: null,
        conflictNotice: MAP_DATA_CHANGED_MESSAGE,
        error: null,
        toast: null,
        result: null,
    };
}

export function completeApplyFailure(state: ApplyFlowState, message: string): ApplyFlowState {
    return {
        ...state,
        phase: state.confirmation ? "confirming" : "idle",
        error: message,
        toast: null,
        result: null,
    };
}

export function clearApplyToast(state: ApplyFlowState): ApplyFlowState {
    return { ...state, toast: null };
}

function formatPoint(point: { latitude: number; longitude: number } | null | undefined): string {
    if (!isValidEvidenceCoordinate(point)) return "—";
    return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
}

function affectedLabel(report: AdminReportDetail): string {
    const count = report.review?.affected_route_count;
    if (typeof count !== "number" || !Number.isFinite(count)) {
        return "—";
    }
    return String(count);
}

/**
 * Build confirmation copy from trusted report review data only.
 * Never invents client-side proposed coordinates or names.
 */
export function buildApplyConfirmation(
    report: AdminReportDetail,
    action: ReportReviewActionCode
): ApplyConfirmationSummary | null {
    if (report.source_code !== "field_survey" || !report.review) {
        return null;
    }
    const allowed = report.review.allowedActions.find((item) => item.action === action);
    if (!allowed?.enabled) {
        return null;
    }

    const facts = buildReportDetailKeyFacts(report, () => "—");
    const coords = report.review.coordinates;
    const actionLabel = PRIMARY_ACTION_LABELS[action];
    const mapMutating =
        action === "MOVE_STOP" ||
        action === "REMOVE_FROM_ROUTE" ||
        action === "CREATE_AND_INSERT_STOP" ||
        action === "UPDATE_STOP_DETAILS";
    const staleWarning =
        mapMutating && report.field?.snapshot_stale ? STALE_SNAPSHOT_WARNING : null;
    const base = {
        action,
        actionLabel,
        target: facts.targetStop,
        affectedVariantsLabel: affectedLabel(report),
        tone: action === "REJECT" ? ("danger" as const) : ("default" as const),
        confirmLabel: action === "REJECT" ? "Reject report" : `Confirm ${actionLabel.toLowerCase()}`,
        staleWarning,
    };

    if (action === "MOVE_STOP") {
        const distance =
            isValidEvidenceCoordinate(coords.current) && isValidEvidenceCoordinate(coords.proposed)
                ? formatEvidenceDistanceMeters(haversineMeters(coords.current, coords.proposed))
                : null;
        return {
            ...base,
            oldValue: formatPoint(coords.current),
            proposedValue: formatPoint(coords.proposed),
            changeDetail: distance ? `Distance ${distance}` : null,
        };
    }

    if (action === "REMOVE_FROM_ROUTE") {
        const sequence = report.review.target_stop?.sequence;
        return {
            ...base,
            oldValue:
                report.review.target_stop?.name ??
                report.review.target_stop?.public_id ??
                "Stop on variant",
            proposedValue: "Removed from this variant only",
            changeDetail:
                sequence != null
                    ? `Sequence ${sequence} will be repaired`
                    : "Variant sequence will be repaired",
        };
    }

    if (action === "CREATE_AND_INSERT_STOP") {
        const prevSeq = report.review.previous_stop?.sequence;
        return {
            ...base,
            oldValue:
                report.review.previous_stop?.name ??
                report.review.previous_stop?.public_id ??
                "Previous stop",
            proposedValue: report.field?.proposed_stop_name ?? report.review.proposed_change ?? "New stop",
            changeDetail:
                prevSeq != null ? `Insert after sequence ${prevSeq}` : "Insert after previous stop",
        };
    }

    if (action === "UPDATE_STOP_DETAILS") {
        return {
            ...base,
            oldValue: report.review.target_stop?.name ?? report.review.target_stop?.public_id ?? "—",
            proposedValue: report.review.proposed_change ?? report.field?.proposed_stop_name ?? "—",
            changeDetail: "Structured fields only",
        };
    }

    if (action === "RESOLVE") {
        return {
            ...base,
            oldValue: report.status.name || report.status.code,
            proposedValue: "Resolved (no map change)",
            changeDetail: "Closes the report without changing map data",
            confirmLabel: "Resolve without change",
        };
    }

    if (action === "REJECT") {
        return {
            ...base,
            oldValue: report.status.name || report.status.code,
            proposedValue: "Rejected",
            changeDetail: "Closes the report without changing map data",
        };
    }

    return null;
}

export function buildApplyResultSummary(
    action: ReportReviewActionCode,
    applyResult?: Pick<ReportApplyResult, "message" | "idempotent" | "comparison"> | null
): ApplyResultSummary {
    const actionLabel = PRIMARY_ACTION_LABELS[action];
    const statusLabel = action === "REJECT" ? "Rejected" : "Resolved";
    const affected =
        applyResult?.comparison?.affected_variant_count != null
            ? `${applyResult.comparison.affected_variant_count} variant(s) affected`
            : null;
    const detailParts = [
        applyResult?.idempotent ? "Already applied" : actionLabel,
        affected,
        applyResult?.message,
    ].filter(Boolean);
    return {
        action,
        actionLabel,
        statusLabel,
        detail: detailParts.join(" · ") || actionLabel,
        toastMessage:
            action === "REJECT"
                ? "Report rejected"
                : action === "RESOLVE"
                  ? "Report resolved"
                  : `${actionLabel} applied`,
    };
}

export function isReportApplyConflictError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
        message.includes("409") ||
        message.includes("revision mismatch") ||
        message.includes("stale") ||
        message.includes("map data changed") ||
        message.includes("canonical revision")
    );
}

export function formatReportApplyError(error: unknown): string {
    if (!(error instanceof Error)) {
        return "That action could not be completed.";
    }
    const message = error.message.trim();
    if (!message) {
        return "That action could not be completed.";
    }
    if (message.length > 180) {
        return "That action could not be completed. Try again.";
    }
    return message;
}

/** Body sent to apply — action + revision only. */
export function buildApplyRequestBody(
    action: ReportReviewActionCode,
    expectedCanonicalRevision: string
): { action: ReportReviewActionCode; expectedCanonicalRevision: string } {
    return { action, expectedCanonicalRevision };
}
