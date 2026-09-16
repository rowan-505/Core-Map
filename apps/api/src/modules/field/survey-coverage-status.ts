/** Pure status helpers for Route Coverage and Work History (one-surveyor model). */

import {
    isSurveyorActiveNow,
    SURVEY_ACTIVITY_HEARTBEAT_FRESH_MS,
} from "./survey-activity-status.js";

export { SURVEY_ACTIVITY_HEARTBEAT_FRESH_MS };

export type SurveySessionStatus = "active" | "completed" | "abandoned" | "none";
export type SurveyPresenceStatus = "live" | "stale" | "offline";
export type SurveyCompletionStatus = "none" | "finished" | "not_finished";
export type SurveyCoverageWorkStatus = "not_started" | "partial" | "finished";

export function deriveSessionStatus(
    sessionStatus: string | null | undefined
): SurveySessionStatus {
    if (sessionStatus === "active" || sessionStatus === "completed" || sessionStatus === "abandoned") {
        return sessionStatus;
    }
    return "none";
}

/**
 * live: active session + fresh server-seen activity.
 * stale: active session but heartbeat older than window (or missing).
 * offline: no active session.
 */
export function derivePresenceStatus(input: {
    sessionStatus: string | null | undefined;
    heartbeatAtMs: number | null | undefined;
    nowMs: number;
    freshWithinMs?: number;
}): SurveyPresenceStatus {
    if (input.sessionStatus !== "active") return "offline";
    if (
        isSurveyorActiveNow({
            sessionStatus: input.sessionStatus,
            heartbeatAtMs: input.heartbeatAtMs,
            nowMs: input.nowMs,
            freshWithinMs: input.freshWithinMs,
        })
    ) {
        return "live";
    }
    return "stale";
}

export function deriveCompletionStatus(input: {
    hasCompletionRow: boolean;
    isFinished: boolean;
}): SurveyCompletionStatus {
    if (!input.hasCompletionRow) return "none";
    return input.isFinished ? "finished" : "not_finished";
}

/**
 * Finished: current completion is finished.
 * Partial: not finished AND (session exists OR completion row exists with not finished).
 * Not started: no session AND no completion row.
 */
export function deriveCoverageWorkStatus(input: {
    hasSession: boolean;
    hasCompletionRow: boolean;
    isFinished: boolean;
}): SurveyCoverageWorkStatus {
    if (input.isFinished) return "finished";
    if (input.hasSession || input.hasCompletionRow) return "partial";
    return "not_started";
}

export function isCoverageRemaining(workStatus: SurveyCoverageWorkStatus): boolean {
    return workStatus !== "finished";
}

export function summarizeRouteCoverage(
    rows: Array<{
        workStatus: SurveyCoverageWorkStatus;
        presenceStatus: SurveyPresenceStatus;
        remaining: boolean;
    }>
): {
    totalActiveVariants: number;
    notStarted: number;
    partial: number;
    finished: number;
    remaining: number;
    activeNow: number;
} {
    return {
        totalActiveVariants: rows.length,
        notStarted: rows.filter((row) => row.workStatus === "not_started").length,
        partial: rows.filter((row) => row.workStatus === "partial").length,
        finished: rows.filter((row) => row.workStatus === "finished").length,
        remaining: rows.filter((row) => row.remaining).length,
        activeNow: rows.filter((row) => row.presenceStatus === "live").length,
    };
}
