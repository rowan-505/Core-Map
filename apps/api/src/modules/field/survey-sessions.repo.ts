import { Prisma, type PrismaClient } from "@prisma/client";

import type { SurveySessionIdentifier } from "./survey-sessions.schema.js";

export type SurveySessionStatus = "active" | "completed" | "abandoned";
export type SurveyTrackingState = "idle" | "active";
export type SurveyCompletionStatus = "partial" | "finished";
export type SurveySessionEventType = "START" | "STOP" | "FINISH" | "REOPEN";

export type ActiveFieldVariantRow = {
    id: bigint;
    public_id: string;
    route_public_id: string;
    route_code: string;
    direction_id: number;
    origin_name: string | null;
    destination_name: string | null;
};

export type SurveySessionRow = ActiveFieldVariantRow & {
    session_id: bigint;
    session_public_id: string;
    client_session_id: string;
    created_by: bigint;
    route_variant_id: bigint;
    snapshot_revision: string;
    started_at: Date;
    ended_at: Date | null;
    status: SurveySessionStatus;
    tracking_state: SurveyTrackingState;
    completion_status: SurveyCompletionStatus;
    accumulated_active_seconds: number;
    finished_at: Date | null;
    reopened_at: Date | null;
    last_activity_at: Date | null;
    last_checked_stop_sequence: number | null;
    checked_stop_count: number;
    total_stop_count: number;
    pending_sync_count: number;
    last_gps_accuracy_m: number | null;
    last_lat: number | null;
    last_lng: number | null;
    last_gps_at: Date | null;
    client_sync_state: string | null;
    created_at: Date;
    updated_at: Date;
    report_count: bigint | number;
};

export type SurveySessionSummaryPatch = {
    accumulatedActiveSeconds: number;
    lastActivityAt: Date;
    lastCheckedStopSequence: number | null;
    checkedStopCount: number;
    totalStopCount: number;
    pendingSyncCount: number;
    lastGpsAccuracyM: number | null;
    lastLat: number | null;
    lastLng: number | null;
    lastGpsAt: Date | null;
    clientSyncState: string | null;
};

const surveySessionSelect = Prisma.sql`
    SELECT
        ss.id AS session_id,
        ss.public_id::text AS session_public_id,
        ss.client_session_id::text AS client_session_id,
        ss.created_by,
        ss.route_variant_id,
        ss.snapshot_revision,
        ss.started_at,
        ss.ended_at,
        ss.status,
        ss.tracking_state,
        ss.completion_status,
        ss.accumulated_active_seconds,
        ss.finished_at,
        ss.reopened_at,
        ss.last_activity_at,
        ss.last_checked_stop_sequence,
        ss.checked_stop_count,
        ss.total_stop_count,
        ss.pending_sync_count,
        ss.last_gps_accuracy_m,
        ss.last_lat,
        ss.last_lng,
        ss.last_gps_at,
        ss.client_sync_state,
        ss.created_at,
        ss.updated_at,
        v.id,
        v.public_id::text AS public_id,
        r.public_id::text AS route_public_id,
        r.route_code,
        v.direction_id,
        NULLIF(btrim(v.origin_name), '') AS origin_name,
        NULLIF(btrim(v.destination_name), '') AS destination_name,
        (
            SELECT count(*)
            FROM feedback.user_reports ur
            WHERE ur.survey_session_id = ss.id
        ) AS report_count
    FROM feedback.survey_sessions ss
    JOIN transport.route_variants v ON v.id = ss.route_variant_id
    JOIN transport.routes r ON r.id = v.route_id
`;

export class SurveySessionsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async findActiveUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM app_auth.auth_users
            WHERE public_id::text = ${publicId}
              AND is_active = true
              AND account_status = 'active'
              AND deleted_at IS NULL
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async findActiveFieldVariant(publicId: string): Promise<ActiveFieldVariantRow | null> {
        const rows = await this.prisma.$queryRaw<ActiveFieldVariantRow[]>(Prisma.sql`
            SELECT
                v.id,
                v.public_id::text AS public_id,
                r.public_id::text AS route_public_id,
                r.route_code,
                v.direction_id,
                NULLIF(btrim(v.origin_name), '') AS origin_name,
                NULLIF(btrim(v.destination_name), '') AS destination_name
            FROM transport.route_variants v
            JOIN transport.routes r ON r.id = v.route_id
            WHERE v.public_id = ${publicId}::uuid
              AND v.deleted_at IS NULL
              AND v.is_active = true
              AND v.direction_id IN (0, 1)
              AND coalesce(v.review_status, '') IS DISTINCT FROM 'rejected'
              AND r.deleted_at IS NULL
              AND r.is_active = true
              AND r.mode = 'bus'
              AND r.route_code LIKE 'YBS-%'
              AND coalesce(r.review_status, '') IS DISTINCT FROM 'rejected'
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async insert(input: {
        clientSessionId: string;
        createdBy: bigint;
        routeVariantId: bigint;
        snapshotRevision: string;
        startedAt: Date;
        totalStopCount: number;
        clientEventId?: string;
    }): Promise<{ created: boolean; row: SurveySessionRow }> {
        return this.prisma.$transaction(async (tx) => {
            const inserted = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
                INSERT INTO feedback.survey_sessions (
                    client_session_id,
                    created_by,
                    route_variant_id,
                    snapshot_revision,
                    started_at,
                    status,
                    tracking_state,
                    completion_status,
                    accumulated_active_seconds,
                    last_activity_at,
                    total_stop_count
                ) VALUES (
                    ${input.clientSessionId}::uuid,
                    ${input.createdBy},
                    ${input.routeVariantId},
                    ${input.snapshotRevision},
                    ${input.startedAt},
                    'active',
                    'active',
                    'partial',
                    0,
                    ${input.startedAt},
                    ${input.totalStopCount}
                )
                ON CONFLICT (client_session_id) DO NOTHING
                RETURNING id
            `);
            if (inserted[0]) {
                await this.insertEvent(tx, {
                    sessionId: inserted[0].id,
                    eventType: "START",
                    occurredAt: input.startedAt,
                    clientEventId: input.clientEventId,
                });
            }
            const rows = await tx.$queryRaw<SurveySessionRow[]>(Prisma.sql`
                ${surveySessionSelect}
                WHERE ss.client_session_id = ${input.clientSessionId}::uuid
                LIMIT 1
            `);
            return { created: Boolean(inserted[0]), row: rows[0]! };
        });
    }

    async findOwnedByPublicId(publicId: string, createdBy: bigint): Promise<SurveySessionRow | null> {
        const rows = await this.prisma.$queryRaw<SurveySessionRow[]>(Prisma.sql`
            ${surveySessionSelect}
            WHERE ss.public_id = ${publicId}::uuid
              AND ss.created_by = ${createdBy}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async findOwnedByClientSessionId(
        clientSessionId: string,
        createdBy: bigint
    ): Promise<SurveySessionRow | null> {
        const rows = await this.prisma.$queryRaw<SurveySessionRow[]>(Prisma.sql`
            ${surveySessionSelect}
            WHERE ss.client_session_id = ${clientSessionId}::uuid
              AND ss.created_by = ${createdBy}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async findOwnedByIdentifier(
        identifier: SurveySessionIdentifier,
        createdBy: bigint
    ): Promise<SurveySessionRow | null> {
        return identifier.publicId
            ? this.findOwnedByPublicId(identifier.publicId, createdBy)
            : this.findOwnedByClientSessionId(identifier.clientSessionId!, createdBy);
    }

    async end(input: {
        clientSessionId: string;
        createdBy: bigint;
        status: Exclude<SurveySessionStatus, "active">;
        endedAt: Date;
        accumulatedActiveSeconds?: number;
        clientEventId?: string;
    }): Promise<SurveySessionRow | null> {
        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
                UPDATE feedback.survey_sessions
                SET status = ${input.status},
                    tracking_state = 'idle',
                    ended_at = ${input.endedAt},
                    accumulated_active_seconds = COALESCE(
                        ${input.accumulatedActiveSeconds ?? null},
                        accumulated_active_seconds
                    ),
                    last_activity_at = ${input.endedAt},
                    updated_at = now()
                WHERE client_session_id = ${input.clientSessionId}::uuid
                  AND created_by = ${input.createdBy}
                  AND status = 'active'
                RETURNING id
            `);
            if (updated[0]) {
                await this.insertEvent(tx, {
                    sessionId: updated[0].id,
                    eventType: "STOP",
                    occurredAt: input.endedAt,
                    clientEventId: input.clientEventId,
                });
            }
            const rows = await tx.$queryRaw<SurveySessionRow[]>(Prisma.sql`
                ${surveySessionSelect}
                WHERE ss.client_session_id = ${input.clientSessionId}::uuid
                  AND ss.created_by = ${input.createdBy}
                LIMIT 1
            `);
            return rows[0] ?? null;
        });
    }

    async updateSummary(
        clientSessionId: string,
        createdBy: bigint,
        patch: SurveySessionSummaryPatch
    ): Promise<SurveySessionRow | null> {
        await this.prisma.$executeRaw(Prisma.sql`
            UPDATE feedback.survey_sessions
            SET accumulated_active_seconds = ${patch.accumulatedActiveSeconds},
                last_activity_at = ${patch.lastActivityAt},
                last_checked_stop_sequence = ${patch.lastCheckedStopSequence},
                checked_stop_count = ${patch.checkedStopCount},
                total_stop_count = ${patch.totalStopCount},
                pending_sync_count = ${patch.pendingSyncCount},
                last_gps_accuracy_m = ${patch.lastGpsAccuracyM},
                last_lat = ${patch.lastLat},
                last_lng = ${patch.lastLng},
                last_gps_at = ${patch.lastGpsAt},
                client_sync_state = ${patch.clientSyncState},
                updated_at = now()
            WHERE client_session_id = ${clientSessionId}::uuid
              AND created_by = ${createdBy}
        `);
        return this.findOwnedByClientSessionId(clientSessionId, createdBy);
    }

    async finish(input: {
        clientSessionId: string;
        createdBy: bigint;
        finishedAt: Date;
        stoppedAt?: Date;
        accumulatedActiveSeconds?: number;
        clientEventId?: string;
    }): Promise<SurveySessionRow | null> {
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.$queryRaw<SurveySessionRow[]>(Prisma.sql`
                ${surveySessionSelect}
                WHERE ss.client_session_id = ${input.clientSessionId}::uuid
                  AND ss.created_by = ${input.createdBy}
                LIMIT 1
            `);
            const row = existing[0];
            if (!row) return null;
            if (row.completion_status === "finished") {
                return row;
            }
            const stopAt = input.stoppedAt ?? input.finishedAt;
            const wasActive = row.status === "active";
            await tx.$executeRaw(Prisma.sql`
                UPDATE feedback.survey_sessions
                SET completion_status = 'finished',
                    finished_at = ${input.finishedAt},
                    status = CASE WHEN status = 'active' THEN 'completed' ELSE status END,
                    tracking_state = 'idle',
                    ended_at = CASE
                        WHEN status = 'active' THEN ${stopAt}
                        ELSE ended_at
                    END,
                    accumulated_active_seconds = COALESCE(
                        ${input.accumulatedActiveSeconds ?? null},
                        accumulated_active_seconds
                    ),
                    last_activity_at = ${input.finishedAt},
                    updated_at = now()
                WHERE id = ${row.session_id}
            `);
            if (wasActive) {
                await this.insertEvent(tx, {
                    sessionId: row.session_id,
                    eventType: "STOP",
                    occurredAt: stopAt,
                    clientEventId: undefined,
                });
            }
            await this.insertEvent(tx, {
                sessionId: row.session_id,
                eventType: "FINISH",
                occurredAt: input.finishedAt,
                clientEventId: input.clientEventId,
            });
            const rows = await tx.$queryRaw<SurveySessionRow[]>(Prisma.sql`
                ${surveySessionSelect}
                WHERE ss.id = ${row.session_id}
                LIMIT 1
            `);
            return rows[0] ?? null;
        });
    }

    async reopen(input: {
        clientSessionId: string;
        createdBy: bigint;
        reopenedAt: Date;
        clientEventId?: string;
    }): Promise<SurveySessionRow | null> {
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.$queryRaw<SurveySessionRow[]>(Prisma.sql`
                ${surveySessionSelect}
                WHERE ss.client_session_id = ${input.clientSessionId}::uuid
                  AND ss.created_by = ${input.createdBy}
                LIMIT 1
            `);
            const row = existing[0];
            if (!row) return null;
            if (row.completion_status === "partial") {
                return row;
            }
            await tx.$executeRaw(Prisma.sql`
                UPDATE feedback.survey_sessions
                SET completion_status = 'partial',
                    reopened_at = ${input.reopenedAt},
                    tracking_state = 'idle',
                    last_activity_at = ${input.reopenedAt},
                    updated_at = now()
                WHERE id = ${row.session_id}
            `);
            await this.insertEvent(tx, {
                sessionId: row.session_id,
                eventType: "REOPEN",
                occurredAt: input.reopenedAt,
                clientEventId: input.clientEventId,
            });
            const rows = await tx.$queryRaw<SurveySessionRow[]>(Prisma.sql`
                ${surveySessionSelect}
                WHERE ss.id = ${row.session_id}
                LIMIT 1
            `);
            return rows[0] ?? null;
        });
    }

    async listOwned(input: {
        createdBy: bigint;
        limit: number;
        after?: { startedAt: Date; publicId: string };
    }): Promise<SurveySessionRow[]> {
        const after = input.after
            ? Prisma.sql`AND (ss.started_at, ss.public_id) < (${input.after.startedAt}, ${input.after.publicId}::uuid)`
            : Prisma.empty;
        return this.prisma.$queryRaw<SurveySessionRow[]>(Prisma.sql`
            ${surveySessionSelect}
            WHERE ss.created_by = ${input.createdBy}
            ${after}
            ORDER BY ss.started_at DESC, ss.public_id DESC
            LIMIT ${input.limit + 1}
        `);
    }

    private async insertEvent(
        tx: Prisma.TransactionClient,
        input: {
            sessionId: bigint;
            eventType: SurveySessionEventType;
            occurredAt: Date;
            clientEventId?: string;
        }
    ): Promise<void> {
        if (input.clientEventId) {
            await tx.$executeRaw(Prisma.sql`
                INSERT INTO feedback.survey_session_events (
                    survey_session_id,
                    event_type,
                    occurred_at,
                    client_event_id
                ) VALUES (
                    ${input.sessionId},
                    ${input.eventType},
                    ${input.occurredAt},
                    ${input.clientEventId}::uuid
                )
                ON CONFLICT (survey_session_id, client_event_id)
                    WHERE client_event_id IS NOT NULL
                DO NOTHING
            `);
            return;
        }
        await tx.$executeRaw(Prisma.sql`
            INSERT INTO feedback.survey_session_events (
                survey_session_id,
                event_type,
                occurred_at
            ) VALUES (
                ${input.sessionId},
                ${input.eventType},
                ${input.occurredAt}
            )
        `);
    }
}
