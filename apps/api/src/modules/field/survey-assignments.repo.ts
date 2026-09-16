import { Prisma, type PrismaClient } from "@prisma/client";

export type SurveyAssignmentRow = {
    id: bigint;
    public_id: string;
    surveyor_user_id: bigint;
    surveyor_public_id: string;
    assigned_by_user_id: bigint;
    assigned_by_public_id: string;
    route_variant_id: bigint;
    route_variant_public_id: string;
    route_public_id: string;
    route_code: string;
    direction_id: number;
    assigned_date: Date;
    due_date: Date | null;
    status: "active" | "cancelled";
    cancelled_at: Date | null;
    created_at: Date;
    updated_at: Date;
    has_session: boolean;
    is_finished: boolean;
};

const assignmentSelect = Prisma.sql`
    SELECT
        a.id,
        a.public_id::text AS public_id,
        a.surveyor_user_id,
        su.public_id::text AS surveyor_public_id,
        a.assigned_by_user_id,
        ab.public_id::text AS assigned_by_public_id,
        a.route_variant_id,
        v.public_id::text AS route_variant_public_id,
        r.public_id::text AS route_public_id,
        r.route_code,
        v.direction_id,
        a.assigned_date,
        a.due_date,
        a.status,
        a.cancelled_at,
        a.created_at,
        a.updated_at,
        EXISTS (
            SELECT 1
            FROM feedback.survey_sessions s
            WHERE s.created_by = a.surveyor_user_id
              AND s.route_variant_id = a.route_variant_id
        ) AS has_session,
        COALESCE(
            (
                SELECT c.is_finished
                FROM feedback.survey_variant_completions c
                WHERE c.created_by = a.surveyor_user_id
                  AND c.route_variant_id = a.route_variant_id
                LIMIT 1
            ),
            false
        ) AS is_finished
    FROM feedback.survey_variant_assignments a
    JOIN app_auth.auth_users su ON su.id = a.surveyor_user_id
    JOIN app_auth.auth_users ab ON ab.id = a.assigned_by_user_id
    JOIN transport.route_variants v ON v.id = a.route_variant_id
    JOIN transport.routes r ON r.id = v.route_id
`;

export class SurveyAssignmentsRepository {
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

    async findActiveSurveyorUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT u.id
            FROM app_auth.auth_users u
            JOIN app_auth.auth_user_roles ur ON ur.user_id = u.id
            JOIN app_auth.auth_roles r ON r.id = ur.role_id
            WHERE u.public_id::text = ${publicId}
              AND u.is_active = true
              AND u.account_status = 'active'
              AND u.deleted_at IS NULL
              AND r.code = 'surveyor'
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

    async list(input: {
        surveyorUserId?: bigint;
        status: "active" | "cancelled" | "all";
    }): Promise<SurveyAssignmentRow[]> {
        const filters: Prisma.Sql[] = [];
        if (input.surveyorUserId !== undefined) {
            filters.push(Prisma.sql`a.surveyor_user_id = ${input.surveyorUserId}`);
        }
        if (input.status !== "all") {
            filters.push(Prisma.sql`a.status = ${input.status}`);
        }
        const where =
            filters.length === 0
                ? Prisma.empty
                : Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;
        return this.prisma.$queryRaw<SurveyAssignmentRow[]>(Prisma.sql`
            ${assignmentSelect}
            ${where}
            ORDER BY a.assigned_date DESC, a.id DESC
            LIMIT 500
        `);
    }

    async findByPublicId(publicId: string): Promise<SurveyAssignmentRow | null> {
        const rows = await this.prisma.$queryRaw<SurveyAssignmentRow[]>(Prisma.sql`
            ${assignmentSelect}
            WHERE a.public_id = ${publicId}::uuid
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async create(input: {
        surveyorUserId: bigint;
        assignedByUserId: bigint;
        routeVariantId: bigint;
        assignedDate: string;
        dueDate: string | null;
    }): Promise<SurveyAssignmentRow> {
        const dueSql =
            input.dueDate === null ? Prisma.sql`NULL` : Prisma.sql`${input.dueDate}::date`;
        const rows = await this.prisma.$queryRaw<{ public_id: string }[]>(Prisma.sql`
            INSERT INTO feedback.survey_variant_assignments (
                surveyor_user_id,
                route_variant_id,
                assigned_by_user_id,
                assigned_date,
                due_date,
                status,
                created_at,
                updated_at
            ) VALUES (
                ${input.surveyorUserId},
                ${input.routeVariantId},
                ${input.assignedByUserId},
                ${input.assignedDate}::date,
                ${dueSql},
                'active',
                now(),
                now()
            )
            RETURNING public_id::text AS public_id
        `);
        return (await this.findByPublicId(rows[0]!.public_id))!;
    }

    async update(input: {
        publicId: string;
        assignedDate?: string;
        dueDate?: string | null;
    }): Promise<SurveyAssignmentRow | null> {
        const sets: Prisma.Sql[] = [Prisma.sql`updated_at = now()`];
        if (input.assignedDate !== undefined) {
            sets.push(Prisma.sql`assigned_date = ${input.assignedDate}::date`);
        }
        if (input.dueDate !== undefined) {
            sets.push(
                input.dueDate === null
                    ? Prisma.sql`due_date = NULL`
                    : Prisma.sql`due_date = ${input.dueDate}::date`
            );
        }
        await this.prisma.$executeRaw(Prisma.sql`
            UPDATE feedback.survey_variant_assignments
            SET ${Prisma.join(sets, ", ")}
            WHERE public_id = ${input.publicId}::uuid
              AND status = 'active'
        `);
        return this.findByPublicId(input.publicId);
    }

    async cancel(publicId: string, at: Date): Promise<SurveyAssignmentRow | null> {
        await this.prisma.$executeRaw(Prisma.sql`
            UPDATE feedback.survey_variant_assignments
            SET status = 'cancelled',
                cancelled_at = ${at},
                updated_at = ${at}
            WHERE public_id = ${publicId}::uuid
              AND status = 'active'
        `);
        return this.findByPublicId(publicId);
    }
}
