import { canonicalYbsVariantIdentity } from "../transport/ybs-direction.js";
import {
    SurveyCoverageSurveyorError,
    SurveyCoverageSurveyorRepository,
    resolveCoverageSurveyor,
    type ResolvedCoverageSurveyor,
} from "./survey-coverage-surveyor.js";
import {
    deriveCompletionStatus,
    deriveCoverageWorkStatus,
    derivePresenceStatus,
    deriveSessionStatus,
    isCoverageRemaining,
    summarizeRouteCoverage,
    type SurveyCompletionStatus,
    type SurveyCoverageWorkStatus,
    type SurveyPresenceStatus,
    type SurveySessionStatus,
} from "./survey-coverage-status.js";
import {
    formatCoverageCheckedLabel,
} from "./survey-session-classify.js";
import type { SurveyRouteCoverageQuery } from "./survey-route-coverage.schema.js";
import {
    SurveyRouteCoverageRepository,
    type SurveyRouteCoverageRow,
} from "./survey-route-coverage.repo.js";

export class SurveyRouteCoverageError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code: string,
        public readonly details?: Record<string, unknown>
    ) {
        super(message);
        this.name = "SurveyRouteCoverageError";
    }
}

export type SurveyRouteCoverageItem = {
    route: { publicId: string; code: string };
    variantCode: "D0" | "D1";
    routeVariantPublicId: string;
    workStatus: SurveyCoverageWorkStatus;
    remaining: boolean;
    sessionStatus: SurveySessionStatus;
    presenceStatus: SurveyPresenceStatus;
    completionStatus: SurveyCompletionStatus;
    sessionPublicId: string | null;
    startedAt: string | null;
    lastActivityAt: string | null;
    lastSurveyedAt: string | null;
    activeDurationSeconds: number;
    lastCheckedStopSequence: number | null;
    checkedStopCount: number;
    totalStopCount: number;
    checkedLabel: string;
    latestSessionReportCount: number;
    variantReportCount: number;
    pendingSyncCount: number;
    syncState: string | null;
};

export type SurveyRouteCoverageResponse = {
    generatedAt: string;
    heartbeatFreshWithinSeconds: number;
    surveyor: {
        publicId: string;
        displayName: string;
        email: string;
    };
    summary: {
        totalActiveVariants: number;
        notStarted: number;
        partial: number;
        finished: number;
        remaining: number;
        activeNow: number;
    };
    items: SurveyRouteCoverageItem[];
};

export class SurveyRouteCoverageService {
    constructor(
        private readonly repo: SurveyRouteCoverageRepository,
        private readonly surveyorRepo: SurveyCoverageSurveyorRepository
    ) {}

    async list(
        query: SurveyRouteCoverageQuery,
        now: Date = new Date()
    ): Promise<SurveyRouteCoverageResponse> {
        let surveyor: ResolvedCoverageSurveyor;
        try {
            surveyor = await resolveCoverageSurveyor(
                this.surveyorRepo,
                query.surveyorPublicId
            );
        } catch (error) {
            if (error instanceof SurveyCoverageSurveyorError) {
                throw new SurveyRouteCoverageError(
                    error.message,
                    error.statusCode,
                    error.code,
                    error.details
                );
            }
            throw error;
        }

        const rows = await this.repo.listActiveVariantCoverage({
            surveyorUserId: surveyor.userId,
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
            surveyor: {
                publicId: surveyor.publicId,
                displayName: surveyor.displayName,
                email: surveyor.email,
            },
            summary: summarizeRouteCoverage(
                filtered.map((item) => ({
                    workStatus: item.workStatus,
                    presenceStatus: item.presenceStatus,
                    remaining: item.remaining,
                }))
            ),
            items: filtered,
        };
    }
}

function toItem(row: SurveyRouteCoverageRow, nowMs: number): SurveyRouteCoverageItem {
    const identity = canonicalYbsVariantIdentity(row.route_code, row.direction_id);
    if (!identity) {
        throw new SurveyRouteCoverageError(
            "Coverage route is invalid",
            500,
            "INVALID_ROUTE"
        );
    }
    const workStatus = deriveCoverageWorkStatus({
        hasSession: row.has_session,
        hasCompletionRow: row.has_completion_row,
        isFinished: row.is_finished,
    });
    const heartbeatAt = row.last_activity_at ?? row.last_gps_at;
    const heartbeatAtMs = heartbeatAt ? heartbeatAt.getTime() : null;
    const sessionStatus = deriveSessionStatus(row.session_status);
    const presenceStatus = derivePresenceStatus({
        sessionStatus: row.session_status,
        heartbeatAtMs,
        nowMs,
    });
    const completionStatus = deriveCompletionStatus({
        hasCompletionRow: row.has_completion_row,
        isFinished: row.is_finished,
    });
    const checked = Number(row.checked_stop_count ?? 0);
    const total = Number(row.canonical_total_stop_count ?? 0);
    const lastActivityAt = heartbeatAt?.toISOString() ?? null;
    return {
        route: { publicId: row.route_public_id, code: row.route_code },
        variantCode: identity.directionName,
        routeVariantPublicId: row.route_variant_public_id,
        workStatus,
        remaining: isCoverageRemaining(workStatus),
        sessionStatus,
        presenceStatus,
        completionStatus,
        sessionPublicId: row.session_public_id,
        startedAt: row.session_started_at?.toISOString() ?? null,
        lastActivityAt,
        lastSurveyedAt: lastActivityAt ?? row.session_started_at?.toISOString() ?? null,
        activeDurationSeconds: Number(row.accumulated_active_seconds ?? 0),
        lastCheckedStopSequence:
            row.last_checked_stop_sequence == null
                ? null
                : Number(row.last_checked_stop_sequence),
        checkedStopCount: checked,
        totalStopCount: total,
        checkedLabel: formatCoverageCheckedLabel(checked, total),
        latestSessionReportCount: Number(row.latest_session_report_count ?? 0),
        variantReportCount: Number(row.variant_report_count ?? 0),
        pendingSyncCount: Number(row.pending_sync_count ?? 0),
        syncState: row.client_sync_state,
    };
}
