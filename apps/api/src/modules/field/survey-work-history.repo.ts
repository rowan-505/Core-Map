import { Prisma, type PrismaClient } from "@prisma/client";

export type SurveyWorkHistoryRow = {
    session_public_id: string;
    client_session_id: string;
    session_status: string;
    started_at: Date;
    ended_at: Date | null;
    last_activity_at: Date | null;
    last_gps_at: Date | null;
    last_lat: number | null;
    last_lng: number | null;
    last_gps_accuracy_m: number | null;
    accumulated_active_seconds: number;
    last_checked_stop_sequence: number | null;
    checked_stop_count: number;
    total_stop_count: number;
    pending_sync_count: number;
    client_sync_state: string | null;
    finished_at: Date | null;
    reopened_at: Date | null;
    route_public_id: string;
    route_code: string;
    route_variant_public_id: string;
    direction_id: number;
    report_count: number;
    has_completion_row: boolean;
    is_finished: boolean;
};

export type SurveySessionTimelineRow = {
    session_public_id: string;
    client_session_id: string;
    surveyor_public_id: string;
    surveyor_display_name: string;
    surveyor_email: string;
    session_status: string;
    started_at: Date;
    ended_at: Date | null;
    last_activity_at: Date | null;
    last_gps_at: Date | null;
    last_lat: number | null;
    last_lng: number | null;
    last_gps_accuracy_m: number | null;
    accumulated_active_seconds: number;
    last_checked_stop_sequence: number | null;
    checked_stop_count: number;
    total_stop_count: number;
    pending_sync_count: number;
    client_sync_state: string | null;
    finished_at: Date | null;
    reopened_at: Date | null;
    route_public_id: string;
    route_code: string;
    route_variant_public_id: string;
    direction_id: number;
    report_count: number;
    has_completion_row: boolean;
    is_finished: boolean;
};

export type SurveySessionEventRow = {
    event_type: string;
    occurred_at: Date;
    client_event_id: string | null;
};

/** Completed + <60s + no checks + no reports + no finish/reopen. */
const shortEmptySql = Prisma.sql`
    ss.status = 'completed'
    AND ss.accumulated_active_seconds < 60
    AND COALESCE(ss.checked_stop_count, 0) = 0
    AND COALESCE(rc.report_count, 0) = 0
    AND ss.finished_at IS NULL
    AND ss.reopened_at IS NULL
`;

export class SurveyWorkHistoryRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async countSessions(input: {
        surveyorUserId: bigint;
        from: Date;
        toExclusive: Date;
        routeSearch?: string;
        sessionStatus?: string;
        includeShortSessions: boolean;
    }): Promise<number> {
        const filters = this.sessionFilters(input);
        const shortFilter = input.includeShortSessions
            ? Prisma.empty
            : Prisma.sql`AND NOT (${shortEmptySql})`;
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT COUNT(*)::bigint AS count
            FROM feedback.survey_sessions ss
            JOIN transport.route_variants v ON v.id = ss.route_variant_id
            JOIN transport.routes r ON r.id = v.route_id
            LEFT JOIN LATERAL (
                SELECT COUNT(DISTINCT ur.id)::int AS report_count
                FROM feedback.user_reports ur
                WHERE ur.survey_session_id = ss.id
            ) rc ON TRUE
            WHERE ${Prisma.join(filters, " AND ")}
            ${shortFilter}
        `);
        return Number(rows[0]?.count ?? 0);
    }

    async countShortEmptySessions(input: {
        surveyorUserId: bigint;
        from: Date;
        toExclusive: Date;
        routeSearch?: string;
        sessionStatus?: string;
    }): Promise<number> {
        const filters = this.sessionFilters(input);
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT COUNT(*)::bigint AS count
            FROM feedback.survey_sessions ss
            JOIN transport.route_variants v ON v.id = ss.route_variant_id
            JOIN transport.routes r ON r.id = v.route_id
            LEFT JOIN LATERAL (
                SELECT COUNT(DISTINCT ur.id)::int AS report_count
                FROM feedback.user_reports ur
                WHERE ur.survey_session_id = ss.id
            ) rc ON TRUE
            WHERE ${Prisma.join(filters, " AND ")}
              AND (${shortEmptySql})
        `);
        return Number(rows[0]?.count ?? 0);
    }

    async listSessions(input: {
        surveyorUserId: bigint;
        from: Date;
        toExclusive: Date;
        routeSearch?: string;
        sessionStatus?: string;
        includeShortSessions: boolean;
        limit: number;
        offset: number;
    }): Promise<SurveyWorkHistoryRow[]> {
        const filters = this.sessionFilters(input);
        const shortFilter = input.includeShortSessions
            ? Prisma.empty
            : Prisma.sql`AND NOT (${shortEmptySql})`;
        return this.prisma.$queryRaw<SurveyWorkHistoryRow[]>(Prisma.sql`
            SELECT
                ss.public_id::text AS session_public_id,
                ss.client_session_id::text AS client_session_id,
                ss.status AS session_status,
                ss.started_at,
                ss.ended_at,
                ss.last_activity_at,
                ss.last_gps_at,
                ss.last_lat,
                ss.last_lng,
                ss.last_gps_accuracy_m,
                ss.accumulated_active_seconds,
                ss.last_checked_stop_sequence,
                ss.checked_stop_count,
                ss.total_stop_count,
                ss.pending_sync_count,
                ss.client_sync_state,
                ss.finished_at,
                ss.reopened_at,
                r.public_id::text AS route_public_id,
                r.route_code,
                v.public_id::text AS route_variant_public_id,
                v.direction_id,
                COALESCE(rc.report_count, 0)::int AS report_count,
                (c.route_variant_id IS NOT NULL) AS has_completion_row,
                COALESCE(c.is_finished, false) AS is_finished
            FROM feedback.survey_sessions ss
            JOIN transport.route_variants v ON v.id = ss.route_variant_id
            JOIN transport.routes r ON r.id = v.route_id
            LEFT JOIN feedback.survey_variant_completions c
                ON c.created_by = ss.created_by
               AND c.route_variant_id = ss.route_variant_id
            LEFT JOIN LATERAL (
                SELECT COUNT(DISTINCT ur.id)::int AS report_count
                FROM feedback.user_reports ur
                WHERE ur.survey_session_id = ss.id
            ) rc ON TRUE
            WHERE ${Prisma.join(filters, " AND ")}
            ${shortFilter}
            ORDER BY ss.started_at DESC, ss.id DESC
            LIMIT ${input.limit}
            OFFSET ${input.offset}
        `);
    }

    async findSessionTimeline(publicId: string): Promise<{
        session: SurveySessionTimelineRow | null;
        events: SurveySessionEventRow[];
    }> {
        const sessions = await this.prisma.$queryRaw<SurveySessionTimelineRow[]>(Prisma.sql`
            SELECT
                ss.public_id::text AS session_public_id,
                ss.client_session_id::text AS client_session_id,
                u.public_id::text AS surveyor_public_id,
                u.display_name AS surveyor_display_name,
                u.email AS surveyor_email,
                ss.status AS session_status,
                ss.started_at,
                ss.ended_at,
                ss.last_activity_at,
                ss.last_gps_at,
                ss.last_lat,
                ss.last_lng,
                ss.last_gps_accuracy_m,
                ss.accumulated_active_seconds,
                ss.last_checked_stop_sequence,
                ss.checked_stop_count,
                ss.total_stop_count,
                ss.pending_sync_count,
                ss.client_sync_state,
                ss.finished_at,
                ss.reopened_at,
                r.public_id::text AS route_public_id,
                r.route_code,
                v.public_id::text AS route_variant_public_id,
                v.direction_id,
                COALESCE(rc.report_count, 0)::int AS report_count,
                (c.route_variant_id IS NOT NULL) AS has_completion_row,
                COALESCE(c.is_finished, false) AS is_finished
            FROM feedback.survey_sessions ss
            JOIN app_auth.auth_users u ON u.id = ss.created_by
            JOIN transport.route_variants v ON v.id = ss.route_variant_id
            JOIN transport.routes r ON r.id = v.route_id
            LEFT JOIN feedback.survey_variant_completions c
                ON c.created_by = ss.created_by
               AND c.route_variant_id = ss.route_variant_id
            LEFT JOIN LATERAL (
                SELECT COUNT(DISTINCT ur.id)::int AS report_count
                FROM feedback.user_reports ur
                WHERE ur.survey_session_id = ss.id
            ) rc ON TRUE
            WHERE ss.public_id = ${publicId}::uuid
            LIMIT 1
        `);
        const session = sessions[0] ?? null;
        if (!session) {
            return { session: null, events: [] };
        }
        const events = await this.prisma.$queryRaw<SurveySessionEventRow[]>(Prisma.sql`
            SELECT
                e.event_type,
                e.occurred_at,
                e.client_event_id::text AS client_event_id
            FROM feedback.survey_session_events e
            JOIN feedback.survey_sessions ss ON ss.id = e.survey_session_id
            WHERE ss.public_id = ${publicId}::uuid
            ORDER BY e.occurred_at ASC, e.id ASC
        `);
        return { session, events };
    }

    private sessionFilters(input: {
        surveyorUserId: bigint;
        from: Date;
        toExclusive: Date;
        routeSearch?: string;
        sessionStatus?: string;
    }): Prisma.Sql[] {
        const filters: Prisma.Sql[] = [
            Prisma.sql`ss.created_by = ${input.surveyorUserId}`,
            Prisma.sql`ss.started_at >= ${input.from}`,
            Prisma.sql`ss.started_at < ${input.toExclusive}`,
        ];
        if (input.sessionStatus) {
            filters.push(Prisma.sql`ss.status = ${input.sessionStatus}`);
        }
        if (input.routeSearch?.trim()) {
            const term = `%${input.routeSearch.trim()}%`;
            filters.push(Prisma.sql`r.route_code ILIKE ${term}`);
        }
        return filters;
    }
}
