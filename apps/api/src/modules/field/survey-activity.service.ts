import { canonicalYbsVariantIdentity } from "../transport/ybs-direction.js";
import {
    deriveSurveyActivityWorkStatus,
    isSurveyActivityRemaining,
    isSurveyorActiveNow,
    summarizeSurveyActivity,
    surveyPresenceLabel,
    type SurveyActivityWorkStatus,
} from "./survey-activity-status.js";
import type { SurveyActivityListQuery } from "./survey-activity.schema.js";
import {
    SurveyActivityRepository,
    type SurveyActivityRow,
} from "./survey-activity.repo.js";

export class SurveyActivityError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code: string
    ) {
        super(message);
        this.name = "SurveyActivityError";
    }
}

export type SurveyActivityItem = {
    assignmentPublicId: string;
    surveyor: {
        publicId: string;
        displayName: string;
        email: string;
    };
    route: { publicId: string; code: string };
    variantCode: "D0" | "D1";
    routeVariantPublicId: string;
    assignedDate: string;
    workStatus: SurveyActivityWorkStatus;
    remaining: boolean;
    presence: {
        kind: "active_now" | "last_seen" | "none";
        label: string;
        activeNow: boolean;
    };
    lastCheckedStopSequence: number | null;
    checkedStopCount: number;
    totalStopCount: number;
    checkedLabel: string;
    reportCount: number;
    pendingSyncCount: number;
    startedAt: string | null;
    activeDurationSeconds: number;
    lastActivityAt: string | null;
    syncState: string | null;
};

export type SurveyActivityResponse = {
    generatedAt: string;
    heartbeatFreshWithinSeconds: number;
    summary: {
        activeNow: number;
        assigned: number;
        partial: number;
        finished: number;
        remaining: number;
        pendingSync: number;
    };
    items: SurveyActivityItem[];
};

export class SurveyActivityService {
    constructor(private readonly repo: SurveyActivityRepository) {}

    async list(
        query: SurveyActivityListQuery,
        now: Date = new Date()
    ): Promise<SurveyActivityResponse> {
        const rows = await this.repo.listActiveAssignments({
            surveyorPublicId: query.surveyorPublicId,
            date: query.date,
            routeSearch: query.routeSearch,
        });
        const nowMs = now.getTime();
        const mapped = rows.map((row) => toItem(row, nowMs));
        const filtered =
            query.workStatus === undefined
                ? mapped
                : mapped.filter((item) => item.workStatus === query.workStatus);
        return {
            generatedAt: now.toISOString(),
            heartbeatFreshWithinSeconds: 120,
            summary: summarizeSurveyActivity(
                filtered.map((item) => ({
                    activeNow: item.presence.activeNow,
                    workStatus: item.workStatus,
                    remaining: item.remaining,
                    pendingSyncCount: item.pendingSyncCount,
                }))
            ),
            items: filtered,
        };
    }
}

function toItem(row: SurveyActivityRow, nowMs: number): SurveyActivityItem {
    const identity = canonicalYbsVariantIdentity(row.route_code, row.direction_id);
    if (!identity) {
        throw new SurveyActivityError("Survey activity route is invalid", 500, "INVALID_ROUTE");
    }
    const workStatus = deriveSurveyActivityWorkStatus({
        hasSession: row.has_session,
        isFinished: row.is_finished,
    });
    const heartbeatAt = row.last_activity_at ?? row.last_gps_at;
    const heartbeatAtMs = heartbeatAt ? heartbeatAt.getTime() : null;
    const activeNow = isSurveyorActiveNow({
        sessionStatus: row.session_status,
        heartbeatAtMs,
        nowMs,
    });
    const lastSeenIso = heartbeatAt?.toISOString() ?? null;
    const presenceBase = surveyPresenceLabel({
        activeNow,
        lastSeenAt: lastSeenIso,
    });
    const presenceLabel =
        presenceBase.kind === "last_seen" && lastSeenIso
            ? `Last seen ${formatShortTime(lastSeenIso)}`
            : presenceBase.label;
    const checked = Number(row.checked_stop_count ?? 0);
    const total = Number(row.total_stop_count ?? 0);
    return {
        assignmentPublicId: row.assignment_public_id,
        surveyor: {
            publicId: row.surveyor_public_id,
            displayName: row.surveyor_display_name,
            email: row.surveyor_email,
        },
        route: { publicId: row.route_public_id, code: row.route_code },
        variantCode: identity.directionName,
        routeVariantPublicId: row.route_variant_public_id,
        assignedDate: formatDate(row.assigned_date),
        workStatus,
        remaining: isSurveyActivityRemaining({
            assignmentStatus: row.assignment_status,
            workStatus,
        }),
        presence: {
            kind: presenceBase.kind,
            label: presenceLabel,
            activeNow,
        },
        lastCheckedStopSequence:
            row.last_checked_stop_sequence == null
                ? null
                : Number(row.last_checked_stop_sequence),
        checkedStopCount: checked,
        totalStopCount: total,
        checkedLabel: `${checked} / ${total}`,
        reportCount: Number(row.report_count ?? 0),
        pendingSyncCount: Number(row.pending_sync_count ?? 0),
        startedAt: row.session_started_at?.toISOString() ?? null,
        activeDurationSeconds: Number(row.accumulated_active_seconds ?? 0),
        lastActivityAt: lastSeenIso,
        syncState: row.client_sync_state,
    };
}

function formatDate(value: Date): string {
    return value.toISOString().slice(0, 10);
}

function formatShortTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return `${date.toISOString().replace("T", " ").slice(0, 16)}Z`;
}
