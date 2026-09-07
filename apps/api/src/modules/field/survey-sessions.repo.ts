import { Prisma, type PrismaClient } from "@prisma/client";

import type { SurveySessionIdentifier } from "./survey-sessions.schema.js";

export type SurveySessionStatus = "active" | "completed" | "abandoned";

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
    created_at: Date;
    updated_at: Date;
    report_count: bigint | number;
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
    }): Promise<{ created: boolean; row: SurveySessionRow }> {
        return this.prisma.$transaction(async (tx) => {
            const inserted = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
                INSERT INTO feedback.survey_sessions (
                    client_session_id,
                    created_by,
                    route_variant_id,
                    snapshot_revision,
                    started_at,
                    status
                ) VALUES (
                    ${input.clientSessionId}::uuid,
                    ${input.createdBy},
                    ${input.routeVariantId},
                    ${input.snapshotRevision},
                    ${input.startedAt},
                    'active'
                )
                ON CONFLICT (client_session_id) DO NOTHING
                RETURNING id
            `);
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
    }): Promise<SurveySessionRow | null> {
        await this.prisma.$executeRaw(Prisma.sql`
            UPDATE feedback.survey_sessions
            SET status = ${input.status},
                ended_at = ${input.endedAt},
                updated_at = now()
            WHERE client_session_id = ${input.clientSessionId}::uuid
              AND created_by = ${input.createdBy}
              AND status = 'active'
        `);
        return this.findOwnedByClientSessionId(input.clientSessionId, input.createdBy);
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
}
