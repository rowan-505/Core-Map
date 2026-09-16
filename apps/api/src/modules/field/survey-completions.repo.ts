import { Prisma, type PrismaClient } from "@prisma/client";

export type SurveyCompletionRow = {
    id: bigint;
    created_by: bigint;
    route_variant_id: bigint;
    route_variant_public_id: string;
    route_public_id: string;
    route_code: string;
    direction_id: number;
    is_finished: boolean;
    finished_at: Date | null;
    updated_at: Date;
    created_at: Date;
};

const completionSelect = Prisma.sql`
    SELECT
        c.id,
        c.created_by,
        c.route_variant_id,
        v.public_id::text AS route_variant_public_id,
        r.public_id::text AS route_public_id,
        r.route_code,
        v.direction_id,
        c.is_finished,
        c.finished_at,
        c.updated_at,
        c.created_at
    FROM feedback.survey_variant_completions c
    JOIN transport.route_variants v ON v.id = c.route_variant_id
    JOIN transport.routes r ON r.id = v.route_id
`;

export class SurveyCompletionsRepository {
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

    async findActiveFieldVariantId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT v.id
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
        return rows[0]?.id ?? null;
    }

    async listOwned(createdBy: bigint): Promise<SurveyCompletionRow[]> {
        return this.prisma.$queryRaw<SurveyCompletionRow[]>(Prisma.sql`
            ${completionSelect}
            WHERE c.created_by = ${createdBy}
            ORDER BY c.updated_at DESC, c.id DESC
        `);
    }

    async upsertOwned(input: {
        createdBy: bigint;
        routeVariantId: bigint;
        finished: boolean;
        at: Date;
    }): Promise<SurveyCompletionRow> {
        await this.prisma.$executeRaw(Prisma.sql`
            INSERT INTO feedback.survey_variant_completions (
                created_by,
                route_variant_id,
                is_finished,
                finished_at,
                updated_at,
                created_at
            ) VALUES (
                ${input.createdBy},
                ${input.routeVariantId},
                ${input.finished},
                CASE WHEN ${input.finished} THEN ${input.at} ELSE NULL END,
                ${input.at},
                ${input.at}
            )
            ON CONFLICT (created_by, route_variant_id) DO UPDATE SET
                is_finished = EXCLUDED.is_finished,
                finished_at = CASE
                    WHEN EXCLUDED.is_finished = false THEN NULL
                    WHEN feedback.survey_variant_completions.is_finished = true
                        THEN feedback.survey_variant_completions.finished_at
                    ELSE EXCLUDED.finished_at
                END,
                updated_at = EXCLUDED.updated_at
        `);
        const rows = await this.prisma.$queryRaw<SurveyCompletionRow[]>(Prisma.sql`
            ${completionSelect}
            WHERE c.created_by = ${input.createdBy}
              AND c.route_variant_id = ${input.routeVariantId}
            LIMIT 1
        `);
        return rows[0]!;
    }
}
