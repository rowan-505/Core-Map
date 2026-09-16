import { Prisma, type PrismaClient } from "@prisma/client";

/** Same active YBS scope as field bootstrap (field.repo.ts). */
const ybsRouteFilter = Prisma.sql`
    r.deleted_at IS NULL
    AND r.is_active = true
    AND r.mode = 'bus'
    AND r.route_code LIKE 'YBS-%'
    AND coalesce(r.review_status, '') IS DISTINCT FROM 'rejected'
`;

const ybsVariantFilter = Prisma.sql`
    v.deleted_at IS NULL
    AND v.is_active = true
    AND v.direction_id IN (0, 1)
    AND coalesce(v.review_status, '') IS DISTINCT FROM 'rejected'
`;

export type SurveyRouteCoverageRow = {
    route_public_id: string;
    route_code: string;
    route_variant_public_id: string;
    direction_id: number;
    has_session: boolean;
    has_completion_row: boolean;
    is_finished: boolean;
    session_public_id: string | null;
    session_status: string | null;
    session_started_at: Date | null;
    last_activity_at: Date | null;
    last_gps_at: Date | null;
    accumulated_active_seconds: number | null;
    last_checked_stop_sequence: number | null;
    checked_stop_count: number | null;
    /** Saved on latest session (may be stale or zero). */
    session_total_stop_count: number | null;
    /** Canonical ordered stops for the active variant. */
    canonical_total_stop_count: number;
    latest_session_report_count: number;
    variant_report_count: number;
    pending_sync_count: number | null;
    client_sync_state: string | null;
};

/**
 * Pre-aggregates report counts and stop totals, then joins to active variants.
 * Avoids counting inflation from sessions/events joins.
 */
export class SurveyRouteCoverageRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listActiveVariantCoverage(input: {
        surveyorUserId: bigint;
        routeSearch?: string;
    }): Promise<SurveyRouteCoverageRow[]> {
        const filters: Prisma.Sql[] = [ybsRouteFilter, ybsVariantFilter];
        if (input.routeSearch?.trim()) {
            const term = `%${input.routeSearch.trim()}%`;
            filters.push(Prisma.sql`r.route_code ILIKE ${term}`);
        }

        return this.prisma.$queryRaw<SurveyRouteCoverageRow[]>(Prisma.sql`
            WITH variant_report_counts AS (
                SELECT
                    ss.route_variant_id,
                    COUNT(DISTINCT ur.id)::int AS report_count
                FROM feedback.survey_sessions ss
                JOIN feedback.user_reports ur ON ur.survey_session_id = ss.id
                WHERE ss.created_by = ${input.surveyorUserId}
                GROUP BY ss.route_variant_id
            ),
            latest_sessions AS (
                SELECT DISTINCT ON (s.route_variant_id)
                    s.*
                FROM feedback.survey_sessions s
                WHERE s.created_by = ${input.surveyorUserId}
                ORDER BY s.route_variant_id, s.started_at DESC, s.id DESC
            ),
            latest_session_report_counts AS (
                SELECT
                    ls.route_variant_id,
                    COUNT(DISTINCT ur.id)::int AS report_count
                FROM latest_sessions ls
                LEFT JOIN feedback.user_reports ur ON ur.survey_session_id = ls.id
                GROUP BY ls.route_variant_id
            ),
            variant_stop_counts AS (
                SELECT
                    rs.route_variant_id,
                    COUNT(*)::int AS total_stops
                FROM transport.route_stops rs
                GROUP BY rs.route_variant_id
            )
            SELECT
                r.public_id::text AS route_public_id,
                r.route_code,
                v.public_id::text AS route_variant_public_id,
                v.direction_id,
                (ls.id IS NOT NULL) AS has_session,
                (c.route_variant_id IS NOT NULL) AS has_completion_row,
                COALESCE(c.is_finished, false) AS is_finished,
                ls.public_id::text AS session_public_id,
                ls.status AS session_status,
                ls.started_at AS session_started_at,
                ls.last_activity_at,
                ls.last_gps_at,
                ls.accumulated_active_seconds,
                ls.last_checked_stop_sequence,
                ls.checked_stop_count,
                ls.total_stop_count AS session_total_stop_count,
                COALESCE(vsc.total_stops, 0)::int AS canonical_total_stop_count,
                COALESCE(lrc.report_count, 0)::int AS latest_session_report_count,
                COALESCE(vrc.report_count, 0)::int AS variant_report_count,
                ls.pending_sync_count,
                ls.client_sync_state
            FROM transport.route_variants v
            JOIN transport.routes r ON r.id = v.route_id
            LEFT JOIN latest_sessions ls ON ls.route_variant_id = v.id
            LEFT JOIN feedback.survey_variant_completions c
                ON c.created_by = ${input.surveyorUserId}
               AND c.route_variant_id = v.id
            LEFT JOIN variant_report_counts vrc ON vrc.route_variant_id = v.id
            LEFT JOIN latest_session_report_counts lrc ON lrc.route_variant_id = v.id
            LEFT JOIN variant_stop_counts vsc ON vsc.route_variant_id = v.id
            WHERE ${Prisma.join(filters, " AND ")}
            ORDER BY r.route_code ASC, v.direction_id ASC, v.id ASC
        `);
    }
}
