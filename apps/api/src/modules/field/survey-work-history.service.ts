import { canonicalYbsVariantIdentity } from "../transport/ybs-direction.js";
import {
    SurveyCoverageSurveyorError,
    SurveyCoverageSurveyorRepository,
    resolveCoverageSurveyor,
    type ResolvedCoverageSurveyor,
} from "./survey-coverage-surveyor.js";
import {
    deriveCompletionStatus,
    derivePresenceStatus,
    deriveSessionStatus,
    type SurveyCompletionStatus,
    type SurveyPresenceStatus,
    type SurveySessionStatus,
} from "./survey-coverage-status.js";
import {
    formatHistoricalCheckedLabel,
    formatReportCountLabel,
    isShortEmptySession,
} from "./survey-session-classify.js";
import type { SurveyWorkHistoryQuery } from "./survey-work-history.schema.js";
import {
    SurveyWorkHistoryRepository,
    type SurveySessionEventRow,
    type SurveySessionTimelineRow,
    type SurveyWorkHistoryRow,
} from "./survey-work-history.repo.js";

export class SurveyWorkHistoryError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code: string,
        public readonly details?: Record<string, unknown>
    ) {
        super(message);
        this.name = "SurveyWorkHistoryError";
    }
}

export type SurveyWorkHistoryItem = {
    sessionPublicId: string;
    clientSessionId: string;
    route: { publicId: string; code: string };
    variantCode: "D0" | "D1";
    routeVariantPublicId: string;
    sessionStatus: SurveySessionStatus;
    presenceStatus: SurveyPresenceStatus;
    /** Current personal completion for this variant — not historical-at-session-end. */
    currentCompletionStatus: SurveyCompletionStatus;
    startedAt: string;
    endedAt: string | null;
    lastActivityAt: string | null;
    activeDurationSeconds: number;
    lastCheckedStopSequence: number | null;
    checkedStopCount: number;
    totalStopCount: number;
    checkedLabel: string;
    reportCount: number;
    reportCountLabel: string;
    isShortEmptySession: boolean;
    pendingSyncCount: number;
    syncState: string | null;
    lastPosition: {
        lat: number;
        lng: number;
        accuracyM: number | null;
        at: string | null;
    } | null;
};

export type SurveyWorkHistoryResponse = {
    generatedAt: string;
    heartbeatFreshWithinSeconds: number;
    surveyor: {
        publicId: string;
        displayName: string;
        email: string;
    };
    range: { from: string; to: string };
    page: number;
    pageSize: number;
    total: number;
    shortEmptySessionCount: number;
    includeShortSessions: boolean;
    items: SurveyWorkHistoryItem[];
};

export type SurveySessionTimelineResponse = {
    generatedAt: string;
    heartbeatFreshWithinSeconds: number;
    session: {
        publicId: string;
        clientSessionId: string;
        surveyor: {
            publicId: string;
            displayName: string;
            email: string;
        };
        route: { publicId: string; code: string };
        variantCode: "D0" | "D1";
        routeVariantPublicId: string;
        sessionStatus: SurveySessionStatus;
        presenceStatus: SurveyPresenceStatus;
        currentCompletionStatus: SurveyCompletionStatus;
        startedAt: string;
        endedAt: string | null;
        lastActivityAt: string | null;
        activeDurationSeconds: number;
        checkedStopCount: number;
        totalStopCount: number;
        reportCount: number;
        pendingSyncCount: number;
        syncState: string | null;
        lastPosition: {
            lat: number;
            lng: number;
            accuracyM: number | null;
            at: string | null;
        } | null;
    };
    events: Array<{
        eventType: string;
        occurredAt: string;
        clientEventId: string | null;
    }>;
};

export class SurveyWorkHistoryService {
    constructor(
        private readonly repo: SurveyWorkHistoryRepository,
        private readonly surveyorRepo: SurveyCoverageSurveyorRepository
    ) {}

    async list(
        query: SurveyWorkHistoryQuery,
        now: Date = new Date()
    ): Promise<SurveyWorkHistoryResponse> {
        const surveyor = await this.resolveSurveyor(query.surveyorPublicId);
        const { from, toExclusive, fromDate, toDate } = resolveDateRange(query, now);
        const includeShortSessions = query.includeShortSessions === true;
        const filterInput = {
            surveyorUserId: surveyor.userId,
            from,
            toExclusive,
            routeSearch: query.routeSearch,
            sessionStatus: query.sessionStatus,
        };
        const [total, shortEmptySessionCount, rows] = await Promise.all([
            this.repo.countSessions({
                ...filterInput,
                includeShortSessions,
            }),
            this.repo.countShortEmptySessions(filterInput),
            this.repo.listSessions({
                ...filterInput,
                includeShortSessions,
                limit: query.pageSize,
                offset: (query.page - 1) * query.pageSize,
            }),
        ]);
        const nowMs = now.getTime();
        return {
            generatedAt: now.toISOString(),
            heartbeatFreshWithinSeconds: 120,
            surveyor: {
                publicId: surveyor.publicId,
                displayName: surveyor.displayName,
                email: surveyor.email,
            },
            range: { from: fromDate, to: toDate },
            page: query.page,
            pageSize: query.pageSize,
            total,
            shortEmptySessionCount,
            includeShortSessions,
            items: rows.map((row) => toHistoryItem(row, nowMs)),
        };
    }

    async timeline(
        publicId: string,
        now: Date = new Date()
    ): Promise<SurveySessionTimelineResponse> {
        const { session, events } = await this.repo.findSessionTimeline(publicId);
        if (!session) {
            throw new SurveyWorkHistoryError("Survey session not found", 404, "NOT_FOUND");
        }
        return {
            generatedAt: now.toISOString(),
            heartbeatFreshWithinSeconds: 120,
            session: toTimelineSession(session, now.getTime()),
            events: events.map(toTimelineEvent),
        };
    }

    private async resolveSurveyor(surveyorPublicId?: string): Promise<ResolvedCoverageSurveyor> {
        try {
            return await resolveCoverageSurveyor(this.surveyorRepo, surveyorPublicId);
        } catch (error) {
            if (error instanceof SurveyCoverageSurveyorError) {
                throw new SurveyWorkHistoryError(
                    error.message,
                    error.statusCode,
                    error.code,
                    error.details
                );
            }
            throw error;
        }
    }
}

function resolveDateRange(
    query: SurveyWorkHistoryQuery,
    now: Date
): { from: Date; toExclusive: Date; fromDate: string; toDate: string } {
    const toDate = query.to ?? formatDateOnly(now);
    const fromDate =
        query.from ??
        formatDateOnly(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29)));
    const from = parseDateStartUtc(fromDate);
    const toExclusive = addDaysUtc(parseDateStartUtc(toDate), 1);
    return { from, toExclusive, fromDate, toDate };
}

function formatDateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
}

function parseDateStartUtc(yyyyMmDd: string): Date {
    return new Date(`${yyyyMmDd}T00:00:00.000Z`);
}

function addDaysUtc(value: Date, days: number): Date {
    const next = new Date(value.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

function toHistoryItem(row: SurveyWorkHistoryRow, nowMs: number): SurveyWorkHistoryItem {
    const identity = canonicalYbsVariantIdentity(row.route_code, row.direction_id);
    if (!identity) {
        throw new SurveyWorkHistoryError("Work history route is invalid", 500, "INVALID_ROUTE");
    }
    const heartbeatAt = row.last_activity_at ?? row.last_gps_at;
    const heartbeatAtMs = heartbeatAt ? heartbeatAt.getTime() : null;
    const checked = Number(row.checked_stop_count ?? 0);
    const total = Number(row.total_stop_count ?? 0);
    const reportCount = Number(row.report_count ?? 0);
    const activeDurationSeconds = Number(row.accumulated_active_seconds ?? 0);
    return {
        sessionPublicId: row.session_public_id,
        clientSessionId: row.client_session_id,
        route: { publicId: row.route_public_id, code: row.route_code },
        variantCode: identity.directionName,
        routeVariantPublicId: row.route_variant_public_id,
        sessionStatus: deriveSessionStatus(row.session_status),
        presenceStatus: derivePresenceStatus({
            sessionStatus: row.session_status,
            heartbeatAtMs,
            nowMs,
        }),
        currentCompletionStatus: deriveCompletionStatus({
            hasCompletionRow: row.has_completion_row,
            isFinished: row.is_finished,
        }),
        startedAt: row.started_at.toISOString(),
        endedAt: row.ended_at?.toISOString() ?? null,
        lastActivityAt: heartbeatAt?.toISOString() ?? null,
        activeDurationSeconds,
        lastCheckedStopSequence:
            row.last_checked_stop_sequence == null
                ? null
                : Number(row.last_checked_stop_sequence),
        checkedStopCount: checked,
        totalStopCount: total,
        checkedLabel: formatHistoricalCheckedLabel(checked, total > 0 ? total : null),
        reportCount,
        reportCountLabel: formatReportCountLabel(reportCount),
        isShortEmptySession: isShortEmptySession({
            sessionStatus: row.session_status,
            activeDurationSeconds,
            checkedStopCount: checked,
            reportCount,
            finishedAt: row.finished_at,
            reopenedAt: row.reopened_at,
        }),
        pendingSyncCount: Number(row.pending_sync_count ?? 0),
        syncState: row.client_sync_state,
        lastPosition: toLastPosition(row),
    };
}

function toTimelineSession(row: SurveySessionTimelineRow, nowMs: number) {
    const identity = canonicalYbsVariantIdentity(row.route_code, row.direction_id);
    if (!identity) {
        throw new SurveyWorkHistoryError("Timeline route is invalid", 500, "INVALID_ROUTE");
    }
    const heartbeatAt = row.last_activity_at ?? row.last_gps_at;
    const heartbeatAtMs = heartbeatAt ? heartbeatAt.getTime() : null;
    return {
        publicId: row.session_public_id,
        clientSessionId: row.client_session_id,
        surveyor: {
            publicId: row.surveyor_public_id,
            displayName: row.surveyor_display_name,
            email: row.surveyor_email,
        },
        route: { publicId: row.route_public_id, code: row.route_code },
        variantCode: identity.directionName,
        routeVariantPublicId: row.route_variant_public_id,
        sessionStatus: deriveSessionStatus(row.session_status),
        presenceStatus: derivePresenceStatus({
            sessionStatus: row.session_status,
            heartbeatAtMs,
            nowMs,
        }),
        currentCompletionStatus: deriveCompletionStatus({
            hasCompletionRow: row.has_completion_row,
            isFinished: row.is_finished,
        }),
        startedAt: row.started_at.toISOString(),
        endedAt: row.ended_at?.toISOString() ?? null,
        lastActivityAt: heartbeatAt?.toISOString() ?? null,
        activeDurationSeconds: Number(row.accumulated_active_seconds ?? 0),
        checkedStopCount: Number(row.checked_stop_count ?? 0),
        totalStopCount: Number(row.total_stop_count ?? 0),
        checkedLabel: formatHistoricalCheckedLabel(
            Number(row.checked_stop_count ?? 0),
            Number(row.total_stop_count ?? 0) > 0 ? Number(row.total_stop_count) : null
        ),
        reportCount: Number(row.report_count ?? 0),
        reportCountLabel: formatReportCountLabel(Number(row.report_count ?? 0)),
        pendingSyncCount: Number(row.pending_sync_count ?? 0),
        syncState: row.client_sync_state,
        lastPosition: toLastPosition(row),
    };
}

function toTimelineEvent(row: SurveySessionEventRow) {
    return {
        eventType: row.event_type,
        occurredAt: row.occurred_at.toISOString(),
        clientEventId: row.client_event_id,
    };
}

function toLastPosition(row: {
    last_lat: number | null;
    last_lng: number | null;
    last_gps_accuracy_m: number | null;
    last_gps_at: Date | null;
}): {
    lat: number;
    lng: number;
    accuracyM: number | null;
    at: string | null;
} | null {
    if (row.last_lat == null || row.last_lng == null) return null;
    return {
        lat: Number(row.last_lat),
        lng: Number(row.last_lng),
        accuracyM: row.last_gps_accuracy_m == null ? null : Number(row.last_gps_accuracy_m),
        at: row.last_gps_at?.toISOString() ?? null,
    };
}
