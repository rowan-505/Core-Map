/** Pure presence and work-status helpers for Field Survey Activity. */

export const SURVEY_ACTIVITY_HEARTBEAT_FRESH_MS = 2 * 60 * 1000;

export type SurveyActivityWorkStatus = "not_started" | "partial" | "finished";

export function deriveSurveyActivityWorkStatus(input: {
    hasSession: boolean;
    isFinished: boolean;
}): SurveyActivityWorkStatus {
    if (input.isFinished) return "finished";
    if (input.hasSession) return "partial";
    return "not_started";
}

export function isSurveyActivityRemaining(input: {
    assignmentStatus: "active" | "cancelled";
    workStatus: SurveyActivityWorkStatus;
}): boolean {
    return input.assignmentStatus === "active" && input.workStatus !== "finished";
}

/** Active only when the session is active and the heartbeat is fresh. */
export function isSurveyorActiveNow(input: {
    sessionStatus: string | null | undefined;
    heartbeatAtMs: number | null | undefined;
    nowMs: number;
    freshWithinMs?: number;
}): boolean {
    if (input.sessionStatus !== "active") return false;
    if (input.heartbeatAtMs == null || !Number.isFinite(input.heartbeatAtMs)) return false;
    const windowMs = input.freshWithinMs ?? SURVEY_ACTIVITY_HEARTBEAT_FRESH_MS;
    return input.nowMs - input.heartbeatAtMs <= windowMs;
}

export function surveyPresenceLabel(input: {
    activeNow: boolean;
    lastSeenAt: string | null;
}): { kind: "active_now" | "last_seen" | "none"; label: string } {
    if (input.activeNow) {
        return { kind: "active_now", label: "Active now" };
    }
    if (input.lastSeenAt) {
        return { kind: "last_seen", label: `Last seen ${input.lastSeenAt}` };
    }
    return { kind: "none", label: "—" };
}

export function summarizeSurveyActivity(rows: Array<{
    activeNow: boolean;
    workStatus: SurveyActivityWorkStatus;
    remaining: boolean;
    pendingSyncCount: number;
}>): {
    activeNow: number;
    assigned: number;
    partial: number;
    finished: number;
    remaining: number;
    pendingSync: number;
} {
    return {
        activeNow: rows.filter((row) => row.activeNow).length,
        assigned: rows.length,
        partial: rows.filter((row) => row.workStatus === "partial").length,
        finished: rows.filter((row) => row.workStatus === "finished").length,
        remaining: rows.filter((row) => row.remaining).length,
        pendingSync: rows.reduce((sum, row) => sum + Math.max(0, row.pendingSyncCount), 0),
    };
}
