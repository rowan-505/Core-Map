import { Prisma, type PrismaClient } from "@prisma/client";

export type SurveyActivityRow = {
    assignment_public_id: string;
    surveyor_public_id: string;
    surveyor_display_name: string;
    surveyor_email: string;
    route_public_id: string;
    route_code: string;
    route_variant_public_id: string;
    direction_id: number;
    assigned_date: Date;
    assignment_status: "active" | "cancelled";
    has_session: boolean;
    is_finished: boolean;
    session_public_id: string | null;
    session_status: string | null;
    session_started_at: Date | null;
    last_activity_at: Date | null;
    last_gps_at: Date | null;
    accumulated_active_seconds: number | null;
    last_checked_stop_sequence: number | null;
    checked_stop_count: number | null;
    total_stop_count: number | null;
    report_count: number | null;
    pending_sync_count: number | null;
    client_sync_state: string | null;
};

export class SurveyActivityRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listActiveAssignments(input: {
        surveyorPublicId?: string;
        date?: string;
        routeSearch?: string;
    }): Promise<SurveyActivityRow[]> {
        const filters: Prisma.Sql[] = [Prisma.sql`a.status = 'active'`];
        if (input.surveyorPublicId) {
            filters.push(Prisma.sql`su.public_id = ${input.surveyorPublicId}::uuid`);
        }
        if (input.date) {
            filters.push(Prisma.sql`a.assigned_date = ${input.date}::date`);
        }
        if (input.routeSearch && input.routeSearch.trim()) {
            const term = `%${input.routeSearch.trim()}%`;
            filters.push(Prisma.sql`r.route_code ILIKE ${term}`);
        }

        return this.prisma.$queryRaw<SurveyActivityRow[]>(Prisma.sql`
            SELECT
                a.public_id::text AS assignment_public_id,
                su.public_id::text AS surveyor_public_id,
                su.display_name AS surveyor_display_name,
                su.email AS surveyor_email,
                r.public_id::text AS route_public_id,
                r.route_code,
                v.public_id::text AS route_variant_public_id,
                v.direction_id,
                a.assigned_date,
                a.status AS assignment_status,
                (ls.id IS NOT NULL) AS has_session,
                COALESCE(c.is_finished, false) AS is_finished,
                ls.public_id::text AS session_public_id,
                ls.status AS session_status,
                ls.started_at AS session_started_at,
                ls.last_activity_at,
                ls.last_gps_at,
                ls.accumulated_active_seconds,
                ls.last_checked_stop_sequence,
                ls.checked_stop_count,
                ls.total_stop_count,
                COALESCE(rc.report_count, 0)::int AS report_count,
                ls.pending_sync_count,
                ls.client_sync_state
            FROM feedback.survey_variant_assignments a
            JOIN app_auth.auth_users su ON su.id = a.surveyor_user_id
            JOIN transport.route_variants v ON v.id = a.route_variant_id
            JOIN transport.routes r ON r.id = v.route_id
            LEFT JOIN LATERAL (
                SELECT s.*
                FROM feedback.survey_sessions s
                WHERE s.created_by = a.surveyor_user_id
                  AND s.route_variant_id = a.route_variant_id
                ORDER BY s.started_at DESC, s.id DESC
                LIMIT 1
            ) ls ON TRUE
            LEFT JOIN feedback.survey_variant_completions c
                ON c.created_by = a.surveyor_user_id
               AND c.route_variant_id = a.route_variant_id
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS report_count
                FROM feedback.user_reports ur
                WHERE ur.survey_session_id = ls.id
            ) rc ON TRUE
            WHERE ${Prisma.join(filters, " AND ")}
            ORDER BY a.assigned_date DESC, r.route_code ASC, v.direction_id ASC, a.id DESC
            LIMIT 500
        `);
    }
}
