/** Client helpers for Field Survey Work History and Route Coverage. */

export type SurveyCoverageWorkStatus = "not_started" | "partial" | "finished";
export type SurveyPresenceStatus = "live" | "stale" | "offline";
export type SurveyCompletionStatus = "none" | "finished" | "not_finished";

export const SURVEY_ACTIVITY_HEARTBEAT_FRESH_MS = 2 * 60 * 1000;

export function deriveCoverageWorkStatus(input: {
    hasSession: boolean;
    hasCompletionRow: boolean;
    isFinished: boolean;
}): SurveyCoverageWorkStatus {
    if (input.isFinished) return "finished";
    if (input.hasSession || input.hasCompletionRow) return "partial";
    return "not_started";
}

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

export function derivePresenceStatus(input: {
    sessionStatus: string | null | undefined;
    heartbeatAtMs: number | null | undefined;
    nowMs: number;
}): SurveyPresenceStatus {
    if (input.sessionStatus !== "active") return "offline";
    return isSurveyorActiveNow(input) ? "live" : "stale";
}

export function workStatusLabel(status: SurveyCoverageWorkStatus): string {
    switch (status) {
        case "not_started":
            return "Not started";
        case "partial":
            return "Partial";
        case "finished":
            return "Finished";
    }
}

export function presenceStatusLabel(status: SurveyPresenceStatus): string {
    switch (status) {
        case "live":
            return "Active now";
        case "stale":
            return "Stale";
        case "offline":
            return "Offline";
    }
}

export function completionStatusLabel(status: SurveyCompletionStatus): string {
    switch (status) {
        case "none":
            return "None";
        case "finished":
            return "Finished";
        case "not_finished":
            return "Not finished";
    }
}

export function formatActiveDuration(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

export function formatDateTime(value: string | null | undefined): string {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

export function listSurveyRouteCoveragePath(filters: {
    surveyorPublicId?: string;
    workStatus?: string;
    routeSearch?: string;
}): string {
    const params = new URLSearchParams();
    if (filters.surveyorPublicId) params.set("surveyorPublicId", filters.surveyorPublicId);
    if (filters.workStatus) params.set("workStatus", filters.workStatus);
    if (filters.routeSearch?.trim()) params.set("routeSearch", filters.routeSearch.trim());
    const query = params.toString();
    return query ? `/field/survey-route-coverage?${query}` : "/field/survey-route-coverage";
}

export function listSurveyWorkHistoryPath(filters: {
    surveyorPublicId?: string;
    routeSearch?: string;
    sessionStatus?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
    includeShortSessions?: boolean;
}): string {
    const params = new URLSearchParams();
    if (filters.surveyorPublicId) params.set("surveyorPublicId", filters.surveyorPublicId);
    if (filters.routeSearch?.trim()) params.set("routeSearch", filters.routeSearch.trim());
    if (filters.sessionStatus) params.set("sessionStatus", filters.sessionStatus);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.page !== undefined) params.set("page", String(filters.page));
    if (filters.pageSize !== undefined) params.set("pageSize", String(filters.pageSize));
    if (filters.includeShortSessions === true) params.set("includeShortSessions", "true");
    const query = params.toString();
    return query ? `/field/survey-work-history?${query}` : "/field/survey-work-history";
}

export function surveySessionTimelinePath(publicId: string): string {
    return `/field/survey-sessions/${encodeURIComponent(publicId)}/timeline`;
}
