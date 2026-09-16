import { canonicalYbsVariantIdentity } from "../transport/ybs-direction.js";
import {
    SurveySessionsRepository,
    type SurveyCompletionStatus,
    type SurveySessionRow,
    type SurveySessionStatus,
    type SurveyTrackingState,
} from "./survey-sessions.repo.js";
import {
    decodeSurveySessionCursor,
    encodeSurveySessionCursor,
    InvalidSurveySessionCursorError,
    type SurveySessionCreateBody,
    type SurveySessionEndBody,
    type SurveySessionFinishBody,
    type SurveySessionIdentifier,
    type SurveySessionReopenBody,
    type SurveySessionSummaryBody,
} from "./survey-sessions.schema.js";

export class SurveySessionsError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code: string
    ) {
        super(message);
        this.name = "SurveySessionsError";
    }
}

export type SurveySessionResponse = {
    publicId: string;
    clientSessionId: string;
    snapshotRevision: string;
    startedAt: string;
    stoppedAt: string | null;
    endedAt: string | null;
    status: SurveySessionStatus;
    trackingState: SurveyTrackingState;
    completionStatus: SurveyCompletionStatus;
    accumulatedActiveSeconds: number;
    finishedAt: string | null;
    reopenedAt: string | null;
    lastActivityAt: string | null;
    lastCheckedStopSequence: number | null;
    checkedStopCount: number;
    totalStopCount: number;
    reportCount: number;
    pendingSyncCount: number;
    lastGpsAccuracyM: number | null;
    lastLat: number | null;
    lastLng: number | null;
    lastGpsAt: string | null;
    clientSyncState: string | null;
    route: { publicId: string; code: string };
    variant: {
        publicId: string;
        code: "D0" | "D1";
        origin: string | null;
        destination: string | null;
    };
    createdAt: string;
    updatedAt: string;
};

export type SurveySessionPage = {
    items: SurveySessionResponse[];
    nextCursor: string | null;
};

export class SurveySessionsService {
    constructor(private readonly repo: SurveySessionsRepository) {}

    async create(
        jwtSub: string,
        body: SurveySessionCreateBody
    ): Promise<{ created: boolean; session: SurveySessionResponse }> {
        const createdBy = await this.requireUserId(jwtSub);
        const variant = await this.repo.findActiveFieldVariant(body.routeVariantPublicId);
        if (!variant) {
            throw new SurveySessionsError("Route variant is not active", 400, "INVALID_ROUTE_VARIANT");
        }
        const result = await this.repo.insert({
            clientSessionId: body.clientSessionId,
            createdBy,
            routeVariantId: variant.id,
            snapshotRevision: body.snapshotRevision,
            startedAt: body.startedAt,
            totalStopCount: body.totalStopCount ?? 0,
            clientEventId: body.clientEventId,
        });
        if (!result.row || BigInt(result.row.created_by) !== BigInt(createdBy)) {
            throw new SurveySessionsError(
                "Client session id is already in use",
                409,
                "CLIENT_SESSION_ID_CONFLICT"
            );
        }
        if (
            !result.created &&
            (BigInt(result.row.route_variant_id) !== BigInt(variant.id) ||
                result.row.snapshot_revision !== body.snapshotRevision ||
                result.row.started_at.getTime() !== body.startedAt.getTime())
        ) {
            throw new SurveySessionsError(
                "Client session id was already used with different session data",
                409,
                "IDEMPOTENCY_CONFLICT"
            );
        }
        return { created: result.created, session: toResponse(result.row) };
    }

    async get(jwtSub: string, publicId: string): Promise<SurveySessionResponse> {
        const createdBy = await this.requireUserId(jwtSub);
        const row = await this.repo.findOwnedByPublicId(publicId, createdBy);
        if (!row) {
            throw new SurveySessionsError("Survey session not found", 404, "SESSION_NOT_FOUND");
        }
        return toResponse(row);
    }

    async list(jwtSub: string, input: { limit: number; cursor?: string }): Promise<SurveySessionPage> {
        const createdBy = await this.requireUserId(jwtSub);
        let after: { startedAt: Date; publicId: string } | undefined;
        if (input.cursor) {
            try {
                after = decodeSurveySessionCursor(input.cursor);
            } catch (error) {
                if (error instanceof InvalidSurveySessionCursorError) {
                    throw new SurveySessionsError(error.message, 400, "INVALID_CURSOR");
                }
                throw error;
            }
        }
        const rows = await this.repo.listOwned({ createdBy, limit: input.limit, after });
        const hasMore = rows.length > input.limit;
        const pageRows = rows.slice(0, input.limit);
        const last = pageRows.at(-1);
        return {
            items: pageRows.map(toResponse),
            nextCursor:
                hasMore && last
                    ? encodeSurveySessionCursor({
                          startedAt: last.started_at,
                          publicId: last.session_public_id,
                      })
                    : null,
        };
    }

    async complete(
        jwtSub: string,
        clientSessionId: string,
        body: SurveySessionEndBody
    ): Promise<SurveySessionResponse> {
        return this.end(jwtSub, clientSessionId, body, "completed");
    }

    async abandon(
        jwtSub: string,
        clientSessionId: string,
        body: SurveySessionEndBody
    ): Promise<SurveySessionResponse> {
        return this.end(jwtSub, clientSessionId, body, "abandoned");
    }

    async syncSummary(
        jwtSub: string,
        clientSessionId: string,
        body: SurveySessionSummaryBody
    ): Promise<SurveySessionResponse> {
        const createdBy = await this.requireUserId(jwtSub);
        const existing = await this.repo.findOwnedByClientSessionId(clientSessionId, createdBy);
        if (!existing) {
            throw new SurveySessionsError("Survey session not found", 404, "SESSION_NOT_FOUND");
        }
        const allowGps = existing.tracking_state === "active";
        const row = await this.repo.updateSummary(clientSessionId, createdBy, {
            accumulatedActiveSeconds: body.accumulatedActiveSeconds,
            lastActivityAt: body.lastActivityAt,
            lastCheckedStopSequence: body.lastCheckedStopSequence ?? null,
            checkedStopCount: body.checkedStopCount,
            totalStopCount: body.totalStopCount,
            pendingSyncCount: body.pendingSyncCount,
            lastGpsAccuracyM: allowGps
                ? (body.lastGpsAccuracyM ?? null)
                : existing.last_gps_accuracy_m,
            lastLat: allowGps ? (body.lastLat ?? null) : existing.last_lat,
            lastLng: allowGps ? (body.lastLng ?? null) : existing.last_lng,
            lastGpsAt: allowGps ? (body.lastGpsAt ?? null) : existing.last_gps_at,
            clientSyncState: body.clientSyncState ?? null,
        });
        if (!row) {
            throw new SurveySessionsError("Survey session not found", 404, "SESSION_NOT_FOUND");
        }
        return toResponse(row);
    }

    async finish(
        jwtSub: string,
        clientSessionId: string,
        body: SurveySessionFinishBody
    ): Promise<SurveySessionResponse> {
        const createdBy = await this.requireUserId(jwtSub);
        const existing = await this.repo.findOwnedByClientSessionId(clientSessionId, createdBy);
        if (!existing) {
            throw new SurveySessionsError("Survey session not found", 404, "SESSION_NOT_FOUND");
        }
        if (existing.completion_status === "finished") {
            return toResponse(existing);
        }
        if (body.finishedAt.getTime() < existing.started_at.getTime()) {
            throw new SurveySessionsError(
                "finishedAt cannot be before startedAt",
                400,
                "INVALID_SESSION_TIMESTAMPS"
            );
        }
        const row = await this.repo.finish({
            clientSessionId,
            createdBy,
            finishedAt: body.finishedAt,
            stoppedAt: body.stoppedAt,
            accumulatedActiveSeconds: body.accumulatedActiveSeconds,
            clientEventId: body.clientEventId,
        });
        if (!row) {
            throw new SurveySessionsError("Survey session not found", 404, "SESSION_NOT_FOUND");
        }
        return toResponse(row);
    }

    async reopen(
        jwtSub: string,
        clientSessionId: string,
        body: SurveySessionReopenBody
    ): Promise<SurveySessionResponse> {
        const createdBy = await this.requireUserId(jwtSub);
        const existing = await this.repo.findOwnedByClientSessionId(clientSessionId, createdBy);
        if (!existing) {
            throw new SurveySessionsError("Survey session not found", 404, "SESSION_NOT_FOUND");
        }
        if (existing.completion_status === "partial") {
            return toResponse(existing);
        }
        const row = await this.repo.reopen({
            clientSessionId,
            createdBy,
            reopenedAt: body.reopenedAt,
            clientEventId: body.clientEventId,
        });
        if (!row) {
            throw new SurveySessionsError("Survey session not found", 404, "SESSION_NOT_FOUND");
        }
        return toResponse(row);
    }

    async requireOwnedForReport(
        createdBy: bigint,
        identifier: SurveySessionIdentifier,
        reportVariantPublicId: string | undefined,
        observedAt: Date
    ): Promise<SurveySessionRow> {
        const row = await this.repo.findOwnedByIdentifier(identifier, createdBy);
        if (!row) {
            throw new SurveySessionsError("Survey session not found", 404, "SESSION_NOT_FOUND");
        }
        const outsideSessionWindow =
            observedAt.getTime() < row.started_at.getTime() ||
            (row.ended_at !== null && observedAt.getTime() > row.ended_at.getTime());
        if (outsideSessionWindow) {
            throw new SurveySessionsError(
                "Report observation is outside the survey session window",
                409,
                "REPORT_OUTSIDE_SESSION"
            );
        }
        if (!reportVariantPublicId || reportVariantPublicId !== row.public_id) {
            throw new SurveySessionsError(
                "Report route variant does not match the survey session",
                409,
                "SESSION_ROUTE_MISMATCH"
            );
        }
        return row;
    }

    private async end(
        jwtSub: string,
        clientSessionId: string,
        body: SurveySessionEndBody,
        status: "completed" | "abandoned"
    ): Promise<SurveySessionResponse> {
        const createdBy = await this.requireUserId(jwtSub);
        const existing = await this.repo.findOwnedByClientSessionId(clientSessionId, createdBy);
        if (!existing) {
            throw new SurveySessionsError("Survey session not found", 404, "SESSION_NOT_FOUND");
        }
        if (existing.status === status) {
            return toResponse(existing);
        }
        if (existing.status !== "active") {
            throw new SurveySessionsError(
                "Survey session already ended with another status",
                409,
                "INVALID_SESSION_TRANSITION"
            );
        }
        if (body.endedAt.getTime() < existing.started_at.getTime()) {
            throw new SurveySessionsError(
                "endedAt cannot be before startedAt",
                400,
                "INVALID_SESSION_TIMESTAMPS"
            );
        }
        const row = await this.repo.end({
            clientSessionId,
            createdBy,
            status,
            endedAt: body.endedAt,
            accumulatedActiveSeconds: body.accumulatedActiveSeconds,
            clientEventId: body.clientEventId,
        });
        if (!row) {
            throw new SurveySessionsError("Survey session not found", 404, "SESSION_NOT_FOUND");
        }
        if (row.status !== status) {
            throw new SurveySessionsError(
                "Survey session already ended with another status",
                409,
                "INVALID_SESSION_TRANSITION"
            );
        }
        return toResponse(row);
    }

    private async requireUserId(jwtSub: string): Promise<bigint> {
        const userId = await this.repo.findActiveUserIdByPublicId(jwtSub);
        if (userId === null) {
            throw new SurveySessionsError("User not found", 401, "UNAUTHORIZED");
        }
        return userId;
    }
}

function toResponse(row: SurveySessionRow): SurveySessionResponse {
    const identity = canonicalYbsVariantIdentity(row.route_code, row.direction_id);
    if (!identity) {
        throw new SurveySessionsError("Survey session route is invalid", 500, "INVALID_SESSION_ROUTE");
    }
    return {
        publicId: row.session_public_id,
        clientSessionId: row.client_session_id,
        snapshotRevision: row.snapshot_revision,
        startedAt: row.started_at.toISOString(),
        stoppedAt: row.ended_at?.toISOString() ?? null,
        endedAt: row.ended_at?.toISOString() ?? null,
        status: row.status,
        trackingState: row.tracking_state,
        completionStatus: row.completion_status,
        accumulatedActiveSeconds: Number(row.accumulated_active_seconds ?? 0),
        finishedAt: row.finished_at?.toISOString() ?? null,
        reopenedAt: row.reopened_at?.toISOString() ?? null,
        lastActivityAt: row.last_activity_at?.toISOString() ?? null,
        lastCheckedStopSequence:
            row.last_checked_stop_sequence == null ? null : Number(row.last_checked_stop_sequence),
        checkedStopCount: Number(row.checked_stop_count ?? 0),
        totalStopCount: Number(row.total_stop_count ?? 0),
        reportCount: Number(row.report_count),
        pendingSyncCount: Number(row.pending_sync_count ?? 0),
        lastGpsAccuracyM: row.last_gps_accuracy_m == null ? null : Number(row.last_gps_accuracy_m),
        lastLat: row.last_lat == null ? null : Number(row.last_lat),
        lastLng: row.last_lng == null ? null : Number(row.last_lng),
        lastGpsAt: row.last_gps_at?.toISOString() ?? null,
        clientSyncState: row.client_sync_state,
        route: { publicId: row.route_public_id, code: row.route_code },
        variant: {
            publicId: row.public_id,
            code: identity.directionName,
            origin: row.origin_name,
            destination: row.destination_name,
        },
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}
