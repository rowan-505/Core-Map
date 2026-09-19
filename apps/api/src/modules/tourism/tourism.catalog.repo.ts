/**
 * Admin CRUD for tourism.activities / events / event_occurrences.
 * Audit writes go to system.audit_logs (same pattern as place profiles).
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import {
    TOURISM_SCHEDULE_REVIEW_DUE_SOON_DAYS,
    type TourismScheduleReviewFilter,
} from "./tourism.schedule-review.js";

export type CatalogAuditContext = {
    ipAddress?: string | null;
    userAgent?: string | null;
};

export const TOURISM_ACTIVITY_AUDIT_ENTITY = "tourism_activity";
export const TOURISM_EVENT_AUDIT_ENTITY = "tourism_event";
export const TOURISM_OCCURRENCE_AUDIT_ENTITY = "tourism_event_occurrence";

export type TourismActivityListRow = {
    id: bigint;
    publicId: string;
    name: string;
    shortDescription: string | null;
    activityTypeCode: string;
    activityTypeNameEn: string;
    adminAreaId: bigint;
    adminAreaName: string;
    primaryPlacePublicId: string | null;
    primaryPlaceName: string | null;
    primaryPlaceLat?: number | null;
    primaryPlaceLng?: number | null;
    isActive: boolean;
    isVerified: boolean;
    seasonMode: string;
    seasonStartMonth: number | null;
    seasonEndMonth: number | null;
    displayPriority: number;
    requiresScheduleReview: boolean;
    lastScheduleReviewedAt: Date | null;
    nextReviewDueAt: Date | null;
    scheduleReviewNote: string | null;
    createdAt: Date;
    updatedAt: Date;
};

export type TourismEventListRow = {
    id: bigint;
    publicId: string;
    name: string;
    shortDescription: string | null;
    eventTypeCode: string;
    eventTypeNameEn: string;
    adminAreaId: bigint;
    adminAreaName: string;
    primaryPlacePublicId: string | null;
    primaryPlaceName: string | null;
    isActive: boolean;
    isVerified: boolean;
    requiresScheduleReview: boolean;
    lastScheduleReviewedAt: Date | null;
    nextReviewDueAt: Date | null;
    scheduleReviewNote: string | null;
    nextOccurrenceStartsAt: Date | null;
    nextOccurrenceEndsAt: Date | null;
    nextOccurrenceStatus: string | null;
    nextOccurrencePublicId: string | null;
    lastOccurrenceStartsAt?: Date | null;
    lastOccurrenceEndsAt?: Date | null;
    lastOccurrenceStatus?: string | null;
    lastOccurrencePublicId?: string | null;
    missingNextOccurrence?: boolean;
    createdAt: Date;
    updatedAt: Date;
};

export type TourismOccurrenceRow = {
    id: bigint;
    publicId: string;
    eventId: bigint;
    eventPublicId: string;
    startsAt: Date;
    endsAt: Date;
    status: string;
    scheduleNote: string | null;
    sourceUrl: string | null;
    verifiedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

type Tx = Prisma.TransactionClient;

function activityReviewStatusSql(
    filter: TourismScheduleReviewFilter | undefined,
    now: Date
): Prisma.Sql | null {
    if (!filter) return null;
    const soon = new Date(
        now.getTime() + TOURISM_SCHEDULE_REVIEW_DUE_SOON_DAYS * 86_400_000
    );
    if (filter === "current") {
        return Prisma.sql`
            a.requires_schedule_review = true
            AND a.next_review_due_at IS NOT NULL
            AND a.next_review_due_at > ${soon}
        `;
    }
    if (filter === "due_soon") {
        return Prisma.sql`
            a.requires_schedule_review = true
            AND a.next_review_due_at IS NOT NULL
            AND a.next_review_due_at > ${now}
            AND a.next_review_due_at <= ${soon}
        `;
    }
    if (filter === "overdue") {
        return Prisma.sql`
            a.requires_schedule_review = true
            AND (a.next_review_due_at IS NULL OR a.next_review_due_at <= ${now})
        `;
    }
    // needs_review = due_soon OR overdue
    return Prisma.sql`
        a.requires_schedule_review = true
        AND (
            a.next_review_due_at IS NULL
            OR a.next_review_due_at <= ${soon}
        )
    `;
}

function eventMissingNextOccurrenceSql(now: Date): Prisma.Sql {
    return Prisma.sql`
        e.requires_schedule_review = true
        AND NOT EXISTS (
            SELECT 1
            FROM tourism.event_occurrences AS ox
            WHERE ox.event_id = e.id
              AND ox.status IN ('scheduled', 'confirmed')
              AND ox.starts_at > ${now}
        )
        AND NOT EXISTS (
            SELECT 1
            FROM tourism.event_occurrences AS oy
            WHERE oy.event_id = e.id
              AND oy.status IN ('scheduled', 'confirmed')
              AND oy.ends_at >= ${now}
        )
    `;
}

function eventReviewStatusSql(
    filter: TourismScheduleReviewFilter | undefined,
    now: Date
): Prisma.Sql | null {
    if (!filter) return null;
    const soon = new Date(
        now.getTime() + TOURISM_SCHEDULE_REVIEW_DUE_SOON_DAYS * 86_400_000
    );
    const missing = eventMissingNextOccurrenceSql(now);
    if (filter === "current") {
        return Prisma.sql`
            e.requires_schedule_review = true
            AND e.next_review_due_at IS NOT NULL
            AND e.next_review_due_at > ${soon}
            AND NOT (${missing})
        `;
    }
    if (filter === "due_soon") {
        return Prisma.sql`
            e.requires_schedule_review = true
            AND e.next_review_due_at IS NOT NULL
            AND e.next_review_due_at > ${now}
            AND e.next_review_due_at <= ${soon}
        `;
    }
    if (filter === "overdue") {
        return Prisma.sql`
            e.requires_schedule_review = true
            AND (e.next_review_due_at IS NULL OR e.next_review_due_at <= ${now})
        `;
    }
    return Prisma.sql`
        (
            (
                e.requires_schedule_review = true
                AND (
                    e.next_review_due_at IS NULL
                    OR e.next_review_due_at <= ${soon}
                )
            )
            OR (${missing})
        )
    `;
}

export class TourismCatalogRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async findUsableUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM app_auth.auth_users
            WHERE public_id::text = ${publicId}
              AND deleted_at IS NULL
              AND is_active = true
              AND account_status = 'active'
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async findActiveAdminAreaId(adminAreaId: bigint): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM core.core_admin_areas
            WHERE id = ${adminAreaId}
              AND is_active = true
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async findActivePlaceIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM core.core_places
            WHERE public_id::text = ${publicId}
              AND deleted_at IS NULL
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async findActiveActivityTypeIdByCode(code: string): Promise<bigint | null> {
        const row = await this.prisma.refActivityType.findFirst({
            where: { code, isActive: true },
            select: { id: true },
        });
        return row?.id ?? null;
    }

    async findActiveEventTypeIdByCode(code: string): Promise<bigint | null> {
        const row = await this.prisma.refEventType.findFirst({
            where: { code, isActive: true },
            select: { id: true },
        });
        return row?.id ?? null;
    }

    async listActivityTypes(): Promise<
        Array<{ code: string; nameEn: string; nameMm: string | null; sortOrder: number }>
    > {
        return this.prisma.refActivityType.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: { code: true, nameEn: true, nameMm: true, sortOrder: true },
        });
    }

    async listEventTypes(): Promise<
        Array<{ code: string; nameEn: string; nameMm: string | null; sortOrder: number }>
    > {
        return this.prisma.refEventType.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: { code: true, nameEn: true, nameMm: true, sortOrder: true },
        });
    }

    async listActivities(input: {
        adminAreaId?: bigint;
        activityTypeCode?: string;
        isActive?: boolean;
        isVerified?: boolean;
        q?: string;
        reviewStatus?: TourismScheduleReviewFilter;
        limit: number;
        offset: number;
        now?: Date;
    }): Promise<{ rows: TourismActivityListRow[]; total: number }> {
        const now = input.now ?? new Date();
        const filters: Prisma.Sql[] = [];
        if (input.adminAreaId !== undefined) {
            filters.push(Prisma.sql`a.admin_area_id = ${input.adminAreaId}`);
        }
        if (input.activityTypeCode) {
            filters.push(Prisma.sql`t.code = ${input.activityTypeCode}`);
        }
        if (input.isActive !== undefined) {
            filters.push(Prisma.sql`a.is_active = ${input.isActive}`);
        }
        if (input.isVerified !== undefined) {
            filters.push(Prisma.sql`a.is_verified = ${input.isVerified}`);
        }
        if (input.q) {
            const pattern = `%${input.q}%`;
            filters.push(Prisma.sql`a.name ILIKE ${pattern}`);
        }
        const reviewSql = activityReviewStatusSql(input.reviewStatus, now);
        if (reviewSql) {
            filters.push(reviewSql);
        }
        const whereSql =
            filters.length > 0
                ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`
                : Prisma.empty;

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM tourism.activities AS a
            JOIN ref.ref_activity_types AS t ON t.id = a.activity_type_id
            ${whereSql}
        `);
        const total = Number(countRows[0]?.count ?? 0n);

        const rows = await this.prisma.$queryRaw<TourismActivityListRow[]>(Prisma.sql`
            SELECT
                a.id AS "id",
                a.public_id::text AS "publicId",
                a.name,
                a.short_description AS "shortDescription",
                t.code AS "activityTypeCode",
                t.name_en AS "activityTypeNameEn",
                a.admin_area_id AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                p.public_id::text AS "primaryPlacePublicId",
                COALESCE(p.display_name, p.primary_name) AS "primaryPlaceName",
                a.is_active AS "isActive",
                a.is_verified AS "isVerified",
                a.season_mode AS "seasonMode",
                a.season_start_month AS "seasonStartMonth",
                a.season_end_month AS "seasonEndMonth",
                a.display_priority AS "displayPriority",
                a.requires_schedule_review AS "requiresScheduleReview",
                a.last_schedule_reviewed_at AS "lastScheduleReviewedAt",
                a.next_review_due_at AS "nextReviewDueAt",
                a.schedule_review_note AS "scheduleReviewNote",
                a.created_at AS "createdAt",
                a.updated_at AS "updatedAt"
            FROM tourism.activities AS a
            JOIN ref.ref_activity_types AS t ON t.id = a.activity_type_id
            JOIN core.core_admin_areas AS aa ON aa.id = a.admin_area_id
            LEFT JOIN core.core_places AS p ON p.id = a.primary_place_id
            ${whereSql}
            ORDER BY
                CASE
                    WHEN a.requires_schedule_review AND (a.next_review_due_at IS NULL OR a.next_review_due_at <= ${now}) THEN 0
                    WHEN a.requires_schedule_review AND a.next_review_due_at <= ${new Date(now.getTime() + TOURISM_SCHEDULE_REVIEW_DUE_SOON_DAYS * 86_400_000)} THEN 1
                    ELSE 2
                END,
                a.next_review_due_at ASC NULLS FIRST,
                a.display_priority DESC,
                a.name ASC,
                a.id ASC
            LIMIT ${input.limit}
            OFFSET ${input.offset}
        `);

        return { rows, total };
    }

    async findActivityByPublicId(publicId: string): Promise<TourismActivityListRow | null> {
        const rows = await this.prisma.$queryRaw<TourismActivityListRow[]>(Prisma.sql`
            SELECT
                a.id AS "id",
                a.public_id::text AS "publicId",
                a.name,
                a.short_description AS "shortDescription",
                t.code AS "activityTypeCode",
                t.name_en AS "activityTypeNameEn",
                a.admin_area_id AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                p.public_id::text AS "primaryPlacePublicId",
                COALESCE(p.display_name, p.primary_name) AS "primaryPlaceName",
                a.is_active AS "isActive",
                a.is_verified AS "isVerified",
                a.season_mode AS "seasonMode",
                a.season_start_month AS "seasonStartMonth",
                a.season_end_month AS "seasonEndMonth",
                a.display_priority AS "displayPriority",
                a.requires_schedule_review AS "requiresScheduleReview",
                a.last_schedule_reviewed_at AS "lastScheduleReviewedAt",
                a.next_review_due_at AS "nextReviewDueAt",
                a.schedule_review_note AS "scheduleReviewNote",
                a.created_at AS "createdAt",
                a.updated_at AS "updatedAt"
            FROM tourism.activities AS a
            JOIN ref.ref_activity_types AS t ON t.id = a.activity_type_id
            JOIN core.core_admin_areas AS aa ON aa.id = a.admin_area_id
            LEFT JOIN core.core_places AS p ON p.id = a.primary_place_id
            WHERE a.public_id::text = ${publicId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async createActivity(input: {
        actorUserId: bigint;
        name: string;
        shortDescription: string | null;
        activityTypeId: bigint;
        adminAreaId: bigint;
        primaryPlaceId: bigint | null;
        seasonMode: string;
        seasonStartMonth: number | null;
        seasonEndMonth: number | null;
        displayPriority: number;
        isActive: boolean;
        isVerified: boolean;
        requiresScheduleReview: boolean;
        lastScheduleReviewedAt: Date | null;
        nextReviewDueAt: Date | null;
        scheduleReviewNote: string | null;
        audit: CatalogAuditContext;
        afterSnapshot: Record<string, unknown>;
    }): Promise<TourismActivityListRow> {
        return this.prisma.$transaction(async (tx) => {
            const created = await tx.tourismActivity.create({
                data: {
                    name: input.name,
                    shortDescription: input.shortDescription,
                    activityTypeId: input.activityTypeId,
                    adminAreaId: input.adminAreaId,
                    primaryPlaceId: input.primaryPlaceId,
                    seasonMode: input.seasonMode,
                    seasonStartMonth: input.seasonStartMonth,
                    seasonEndMonth: input.seasonEndMonth,
                    displayPriority: input.displayPriority,
                    isActive: input.isActive,
                    isVerified: input.isVerified,
                    requiresScheduleReview: input.requiresScheduleReview,
                    lastScheduleReviewedAt: input.lastScheduleReviewedAt,
                    nextReviewDueAt: input.nextReviewDueAt,
                    scheduleReviewNote: input.scheduleReviewNote,
                    createdBy: input.actorUserId,
                    updatedBy: input.actorUserId,
                },
                select: { id: true, publicId: true },
            });
            await this.writeAudit(tx, {
                actorUserId: input.actorUserId,
                actionType: "tourism_activity_created",
                entityType: TOURISM_ACTIVITY_AUDIT_ENTITY,
                entityId: created.id,
                beforeSnapshot: null,
                afterSnapshot: input.afterSnapshot,
                audit: input.audit,
            });
            const row = await this.findActivityByPublicIdInTx(tx, created.publicId);
            if (!row) throw new Error("Created activity could not be reloaded");
            return row;
        });
    }

    async updateActivity(input: {
        activityId: bigint;
        publicId: string;
        actorUserId: bigint;
        data: {
            name?: string;
            shortDescription?: string | null;
            activityTypeId?: bigint;
            adminAreaId?: bigint;
            primaryPlaceId?: bigint | null;
            seasonMode?: string;
            seasonStartMonth?: number | null;
            seasonEndMonth?: number | null;
            displayPriority?: number;
            isActive?: boolean;
            isVerified?: boolean;
            requiresScheduleReview?: boolean;
            lastScheduleReviewedAt?: Date | null;
            nextReviewDueAt?: Date | null;
            scheduleReviewNote?: string | null;
        };
        beforeSnapshot: Record<string, unknown>;
        afterSnapshot: Record<string, unknown>;
        audit: CatalogAuditContext;
        actionType?: string;
    }): Promise<TourismActivityListRow> {
        return this.prisma.$transaction(async (tx) => {
            await tx.tourismActivity.update({
                where: { id: input.activityId },
                data: {
                    ...input.data,
                    updatedBy: input.actorUserId,
                },
            });
            await this.writeAudit(tx, {
                actorUserId: input.actorUserId,
                actionType: input.actionType ?? "tourism_activity_updated",
                entityType: TOURISM_ACTIVITY_AUDIT_ENTITY,
                entityId: input.activityId,
                beforeSnapshot: input.beforeSnapshot,
                afterSnapshot: input.afterSnapshot,
                audit: input.audit,
            });
            const row = await this.findActivityByPublicIdInTx(tx, input.publicId);
            if (!row) throw new Error("Updated activity could not be reloaded");
            return row;
        });
    }

    async listEvents(input: {
        adminAreaId?: bigint;
        eventTypeCode?: string;
        isActive?: boolean;
        isVerified?: boolean;
        q?: string;
        upcomingOnly: boolean;
        reviewStatus?: TourismScheduleReviewFilter;
        limit: number;
        offset: number;
        now: Date;
    }): Promise<{ rows: TourismEventListRow[]; total: number }> {
        const filters: Prisma.Sql[] = [];
        if (input.adminAreaId !== undefined) {
            filters.push(Prisma.sql`e.admin_area_id = ${input.adminAreaId}`);
        }
        if (input.eventTypeCode) {
            filters.push(Prisma.sql`t.code = ${input.eventTypeCode}`);
        }
        if (input.isActive !== undefined) {
            filters.push(Prisma.sql`e.is_active = ${input.isActive}`);
        }
        if (input.isVerified !== undefined) {
            filters.push(Prisma.sql`e.is_verified = ${input.isVerified}`);
        }
        if (input.q) {
            const pattern = `%${input.q}%`;
            filters.push(Prisma.sql`e.name ILIKE ${pattern}`);
        }
        if (input.upcomingOnly) {
            filters.push(Prisma.sql`
                EXISTS (
                    SELECT 1
                    FROM tourism.event_occurrences AS o
                    WHERE o.event_id = e.id
                      AND o.status IN ('scheduled', 'confirmed')
                      AND o.starts_at > ${input.now}
                )
            `);
        }
        const reviewSql = eventReviewStatusSql(input.reviewStatus, input.now);
        if (reviewSql) {
            filters.push(reviewSql);
        }
        const whereSql =
            filters.length > 0
                ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`
                : Prisma.empty;
        const soon = new Date(
            input.now.getTime() + TOURISM_SCHEDULE_REVIEW_DUE_SOON_DAYS * 86_400_000
        );
        const missingSql = eventMissingNextOccurrenceSql(input.now);

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM tourism.events AS e
            JOIN ref.ref_event_types AS t ON t.id = e.event_type_id
            ${whereSql}
        `);
        const total = Number(countRows[0]?.count ?? 0n);

        const rows = await this.prisma.$queryRaw<TourismEventListRow[]>(Prisma.sql`
            SELECT
                e.id AS "id",
                e.public_id::text AS "publicId",
                e.name,
                e.short_description AS "shortDescription",
                t.code AS "eventTypeCode",
                t.name_en AS "eventTypeNameEn",
                e.admin_area_id AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                p.public_id::text AS "primaryPlacePublicId",
                COALESCE(p.display_name, p.primary_name) AS "primaryPlaceName",
                e.is_active AS "isActive",
                e.is_verified AS "isVerified",
                e.requires_schedule_review AS "requiresScheduleReview",
                e.last_schedule_reviewed_at AS "lastScheduleReviewedAt",
                e.next_review_due_at AS "nextReviewDueAt",
                e.schedule_review_note AS "scheduleReviewNote",
                nxt.starts_at AS "nextOccurrenceStartsAt",
                nxt.ends_at AS "nextOccurrenceEndsAt",
                nxt.status AS "nextOccurrenceStatus",
                nxt.public_id::text AS "nextOccurrencePublicId",
                prev.starts_at AS "lastOccurrenceStartsAt",
                prev.ends_at AS "lastOccurrenceEndsAt",
                prev.status AS "lastOccurrenceStatus",
                prev.public_id::text AS "lastOccurrencePublicId",
                (${missingSql}) AS "missingNextOccurrence",
                e.created_at AS "createdAt",
                e.updated_at AS "updatedAt"
            FROM tourism.events AS e
            JOIN ref.ref_event_types AS t ON t.id = e.event_type_id
            JOIN core.core_admin_areas AS aa ON aa.id = e.admin_area_id
            LEFT JOIN core.core_places AS p ON p.id = e.primary_place_id
            LEFT JOIN LATERAL (
                SELECT o.starts_at, o.ends_at, o.status, o.public_id
                FROM tourism.event_occurrences AS o
                WHERE o.event_id = e.id
                  AND o.status IN ('scheduled', 'confirmed')
                  AND o.starts_at > ${input.now}
                ORDER BY o.starts_at ASC
                LIMIT 1
            ) AS nxt ON true
            LEFT JOIN LATERAL (
                SELECT o.starts_at, o.ends_at, o.status, o.public_id
                FROM tourism.event_occurrences AS o
                WHERE o.event_id = e.id
                  AND o.ends_at < ${input.now}
                ORDER BY o.ends_at DESC
                LIMIT 1
            ) AS prev ON true
            ${whereSql}
            ORDER BY
                CASE
                    WHEN (${missingSql}) THEN 0
                    WHEN e.requires_schedule_review AND (e.next_review_due_at IS NULL OR e.next_review_due_at <= ${input.now}) THEN 1
                    WHEN e.requires_schedule_review AND e.next_review_due_at <= ${soon} THEN 2
                    ELSE 3
                END,
                e.next_review_due_at ASC NULLS FIRST,
                CASE WHEN nxt.starts_at IS NULL THEN 1 ELSE 0 END,
                nxt.starts_at ASC NULLS LAST,
                e.name ASC,
                e.id ASC
            LIMIT ${input.limit}
            OFFSET ${input.offset}
        `);

        return { rows, total };
    }

    async findEventByPublicId(
        publicId: string,
        now: Date = new Date()
    ): Promise<TourismEventListRow | null> {
        const missingSql = eventMissingNextOccurrenceSql(now);
        const rows = await this.prisma.$queryRaw<TourismEventListRow[]>(Prisma.sql`
            SELECT
                e.id AS "id",
                e.public_id::text AS "publicId",
                e.name,
                e.short_description AS "shortDescription",
                t.code AS "eventTypeCode",
                t.name_en AS "eventTypeNameEn",
                e.admin_area_id AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                p.public_id::text AS "primaryPlacePublicId",
                COALESCE(p.display_name, p.primary_name) AS "primaryPlaceName",
                e.is_active AS "isActive",
                e.is_verified AS "isVerified",
                e.requires_schedule_review AS "requiresScheduleReview",
                e.last_schedule_reviewed_at AS "lastScheduleReviewedAt",
                e.next_review_due_at AS "nextReviewDueAt",
                e.schedule_review_note AS "scheduleReviewNote",
                nxt.starts_at AS "nextOccurrenceStartsAt",
                nxt.ends_at AS "nextOccurrenceEndsAt",
                nxt.status AS "nextOccurrenceStatus",
                nxt.public_id::text AS "nextOccurrencePublicId",
                prev.starts_at AS "lastOccurrenceStartsAt",
                prev.ends_at AS "lastOccurrenceEndsAt",
                prev.status AS "lastOccurrenceStatus",
                prev.public_id::text AS "lastOccurrencePublicId",
                (${missingSql}) AS "missingNextOccurrence",
                e.created_at AS "createdAt",
                e.updated_at AS "updatedAt"
            FROM tourism.events AS e
            JOIN ref.ref_event_types AS t ON t.id = e.event_type_id
            JOIN core.core_admin_areas AS aa ON aa.id = e.admin_area_id
            LEFT JOIN core.core_places AS p ON p.id = e.primary_place_id
            LEFT JOIN LATERAL (
                SELECT o.starts_at, o.ends_at, o.status, o.public_id
                FROM tourism.event_occurrences AS o
                WHERE o.event_id = e.id
                  AND o.status IN ('scheduled', 'confirmed')
                  AND o.starts_at > ${now}
                ORDER BY o.starts_at ASC
                LIMIT 1
            ) AS nxt ON true
            LEFT JOIN LATERAL (
                SELECT o.starts_at, o.ends_at, o.status, o.public_id
                FROM tourism.event_occurrences AS o
                WHERE o.event_id = e.id
                  AND o.ends_at < ${now}
                ORDER BY o.ends_at DESC
                LIMIT 1
            ) AS prev ON true
            WHERE e.public_id::text = ${publicId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async createEvent(input: {
        actorUserId: bigint;
        name: string;
        shortDescription: string | null;
        eventTypeId: bigint;
        adminAreaId: bigint;
        primaryPlaceId: bigint | null;
        isActive: boolean;
        isVerified: boolean;
        requiresScheduleReview: boolean;
        lastScheduleReviewedAt: Date | null;
        nextReviewDueAt: Date | null;
        scheduleReviewNote: string | null;
        audit: CatalogAuditContext;
        afterSnapshot: Record<string, unknown>;
    }): Promise<TourismEventListRow> {
        return this.prisma.$transaction(async (tx) => {
            const created = await tx.tourismEvent.create({
                data: {
                    name: input.name,
                    shortDescription: input.shortDescription,
                    eventTypeId: input.eventTypeId,
                    adminAreaId: input.adminAreaId,
                    primaryPlaceId: input.primaryPlaceId,
                    isActive: input.isActive,
                    isVerified: input.isVerified,
                    requiresScheduleReview: input.requiresScheduleReview,
                    lastScheduleReviewedAt: input.lastScheduleReviewedAt,
                    nextReviewDueAt: input.nextReviewDueAt,
                    scheduleReviewNote: input.scheduleReviewNote,
                    createdBy: input.actorUserId,
                    updatedBy: input.actorUserId,
                },
                select: { id: true, publicId: true },
            });
            await this.writeAudit(tx, {
                actorUserId: input.actorUserId,
                actionType: "tourism_event_created",
                entityType: TOURISM_EVENT_AUDIT_ENTITY,
                entityId: created.id,
                beforeSnapshot: null,
                afterSnapshot: input.afterSnapshot,
                audit: input.audit,
            });
            const row = await this.findEventByPublicIdInTx(tx, created.publicId);
            if (!row) throw new Error("Created event could not be reloaded");
            return row;
        });
    }

    async updateEvent(input: {
        eventId: bigint;
        publicId: string;
        actorUserId: bigint;
        data: {
            name?: string;
            shortDescription?: string | null;
            eventTypeId?: bigint;
            adminAreaId?: bigint;
            primaryPlaceId?: bigint | null;
            isActive?: boolean;
            isVerified?: boolean;
            requiresScheduleReview?: boolean;
            lastScheduleReviewedAt?: Date | null;
            nextReviewDueAt?: Date | null;
            scheduleReviewNote?: string | null;
        };
        beforeSnapshot: Record<string, unknown>;
        afterSnapshot: Record<string, unknown>;
        audit: CatalogAuditContext;
        actionType?: string;
    }): Promise<TourismEventListRow> {
        return this.prisma.$transaction(async (tx) => {
            await tx.tourismEvent.update({
                where: { id: input.eventId },
                data: {
                    ...input.data,
                    updatedBy: input.actorUserId,
                },
            });
            await this.writeAudit(tx, {
                actorUserId: input.actorUserId,
                actionType: input.actionType ?? "tourism_event_updated",
                entityType: TOURISM_EVENT_AUDIT_ENTITY,
                entityId: input.eventId,
                beforeSnapshot: input.beforeSnapshot,
                afterSnapshot: input.afterSnapshot,
                audit: input.audit,
            });
            const row = await this.findEventByPublicIdInTx(tx, input.publicId);
            if (!row) throw new Error("Updated event could not be reloaded");
            return row;
        });
    }

    async confirmActivityScheduleReview(input: {
        activityId: bigint;
        publicId: string;
        actorUserId: bigint;
        nextReviewDueAt: Date;
        scheduleReviewNote: string | null;
        requiresScheduleReview: boolean;
        beforeSnapshot: Record<string, unknown>;
        audit: CatalogAuditContext;
    }): Promise<TourismActivityListRow> {
        const reviewedAt = new Date();
        return this.updateActivity({
            activityId: input.activityId,
            publicId: input.publicId,
            actorUserId: input.actorUserId,
            data: {
                requiresScheduleReview: input.requiresScheduleReview,
                lastScheduleReviewedAt: reviewedAt,
                nextReviewDueAt: input.nextReviewDueAt,
                scheduleReviewNote: input.scheduleReviewNote,
            },
            beforeSnapshot: input.beforeSnapshot,
            afterSnapshot: {
                ...input.beforeSnapshot,
                requires_schedule_review: input.requiresScheduleReview,
                last_schedule_reviewed_at: reviewedAt.toISOString(),
                next_review_due_at: input.nextReviewDueAt.toISOString(),
                schedule_review_note: input.scheduleReviewNote,
            },
            audit: input.audit,
            actionType: "tourism_activity_schedule_reviewed",
        });
    }

    async confirmEventScheduleReview(input: {
        eventId: bigint;
        publicId: string;
        actorUserId: bigint;
        nextReviewDueAt: Date;
        scheduleReviewNote: string | null;
        requiresScheduleReview: boolean;
        beforeSnapshot: Record<string, unknown>;
        audit: CatalogAuditContext;
    }): Promise<TourismEventListRow> {
        const reviewedAt = new Date();
        return this.updateEvent({
            eventId: input.eventId,
            publicId: input.publicId,
            actorUserId: input.actorUserId,
            data: {
                requiresScheduleReview: input.requiresScheduleReview,
                lastScheduleReviewedAt: reviewedAt,
                nextReviewDueAt: input.nextReviewDueAt,
                scheduleReviewNote: input.scheduleReviewNote,
            },
            beforeSnapshot: input.beforeSnapshot,
            afterSnapshot: {
                ...input.beforeSnapshot,
                requires_schedule_review: input.requiresScheduleReview,
                last_schedule_reviewed_at: reviewedAt.toISOString(),
                next_review_due_at: input.nextReviewDueAt.toISOString(),
                schedule_review_note: input.scheduleReviewNote,
            },
            audit: input.audit,
            actionType: "tourism_event_schedule_reviewed",
        });
    }

    async listOccurrencesForEvent(input: {
        eventId: bigint;
        limit: number;
        offset: number;
    }): Promise<{ rows: TourismOccurrenceRow[]; total: number }> {
        const total = await this.prisma.tourismEventOccurrence.count({
            where: { eventId: input.eventId },
        });
        const rows = await this.prisma.$queryRaw<TourismOccurrenceRow[]>(Prisma.sql`
            SELECT
                o.id AS "id",
                o.public_id::text AS "publicId",
                o.event_id AS "eventId",
                e.public_id::text AS "eventPublicId",
                o.starts_at AS "startsAt",
                o.ends_at AS "endsAt",
                o.status,
                o.schedule_note AS "scheduleNote",
                o.source_url AS "sourceUrl",
                o.verified_at AS "verifiedAt",
                o.created_at AS "createdAt",
                o.updated_at AS "updatedAt"
            FROM tourism.event_occurrences AS o
            JOIN tourism.events AS e ON e.id = o.event_id
            WHERE o.event_id = ${input.eventId}
            ORDER BY o.starts_at DESC, o.id DESC
            LIMIT ${input.limit}
            OFFSET ${input.offset}
        `);
        return { rows, total };
    }

    async findOccurrenceByPublicId(
        occurrencePublicId: string
    ): Promise<TourismOccurrenceRow | null> {
        const rows = await this.prisma.$queryRaw<TourismOccurrenceRow[]>(Prisma.sql`
            SELECT
                o.id AS "id",
                o.public_id::text AS "publicId",
                o.event_id AS "eventId",
                e.public_id::text AS "eventPublicId",
                o.starts_at AS "startsAt",
                o.ends_at AS "endsAt",
                o.status,
                o.schedule_note AS "scheduleNote",
                o.source_url AS "sourceUrl",
                o.verified_at AS "verifiedAt",
                o.created_at AS "createdAt",
                o.updated_at AS "updatedAt"
            FROM tourism.event_occurrences AS o
            JOIN tourism.events AS e ON e.id = o.event_id
            WHERE o.public_id::text = ${occurrencePublicId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async createOccurrence(input: {
        actorUserId: bigint;
        eventId: bigint;
        startsAt: Date;
        endsAt: Date;
        status: string;
        scheduleNote: string | null;
        sourceUrl: string | null;
        verifiedAt: Date | null;
        audit: CatalogAuditContext;
        afterSnapshot: Record<string, unknown>;
    }): Promise<TourismOccurrenceRow> {
        return this.prisma.$transaction(async (tx) => {
            const created = await tx.tourismEventOccurrence.create({
                data: {
                    eventId: input.eventId,
                    startsAt: input.startsAt,
                    endsAt: input.endsAt,
                    status: input.status,
                    scheduleNote: input.scheduleNote,
                    sourceUrl: input.sourceUrl,
                    verifiedAt: input.verifiedAt,
                    createdBy: input.actorUserId,
                    updatedBy: input.actorUserId,
                },
                select: { id: true, publicId: true },
            });
            await this.writeAudit(tx, {
                actorUserId: input.actorUserId,
                actionType: "tourism_event_occurrence_created",
                entityType: TOURISM_OCCURRENCE_AUDIT_ENTITY,
                entityId: created.id,
                beforeSnapshot: null,
                afterSnapshot: input.afterSnapshot,
                audit: input.audit,
            });
            const row = await this.findOccurrenceByPublicIdInTx(tx, created.publicId);
            if (!row) throw new Error("Created occurrence could not be reloaded");
            return row;
        });
    }

    async updateOccurrence(input: {
        occurrenceId: bigint;
        publicId: string;
        actorUserId: bigint;
        data: {
            startsAt?: Date;
            endsAt?: Date;
            status?: string;
            scheduleNote?: string | null;
            sourceUrl?: string | null;
            verifiedAt?: Date | null;
        };
        beforeSnapshot: Record<string, unknown>;
        afterSnapshot: Record<string, unknown>;
        audit: CatalogAuditContext;
        actionType: string;
    }): Promise<TourismOccurrenceRow> {
        return this.prisma.$transaction(async (tx) => {
            await tx.tourismEventOccurrence.update({
                where: { id: input.occurrenceId },
                data: {
                    ...input.data,
                    updatedBy: input.actorUserId,
                },
            });
            await this.writeAudit(tx, {
                actorUserId: input.actorUserId,
                actionType: input.actionType,
                entityType: TOURISM_OCCURRENCE_AUDIT_ENTITY,
                entityId: input.occurrenceId,
                beforeSnapshot: input.beforeSnapshot,
                afterSnapshot: input.afterSnapshot,
                audit: input.audit,
            });
            const row = await this.findOccurrenceByPublicIdInTx(tx, input.publicId);
            if (!row) throw new Error("Updated occurrence could not be reloaded");
            return row;
        });
    }

    private async writeAudit(
        tx: Tx,
        input: {
            actorUserId: bigint;
            actionType: string;
            entityType: string;
            entityId: bigint;
            beforeSnapshot: Record<string, unknown> | null;
            afterSnapshot: Record<string, unknown>;
            audit: CatalogAuditContext;
        }
    ): Promise<void> {
        await tx.auditLog.create({
            data: {
                actorUserId: input.actorUserId,
                actionType: input.actionType,
                entityType: input.entityType,
                entityId: input.entityId,
                beforeSnapshot:
                    input.beforeSnapshot === null
                        ? Prisma.JsonNull
                        : (input.beforeSnapshot as Prisma.InputJsonValue),
                afterSnapshot: input.afterSnapshot as Prisma.InputJsonValue,
                ipAddress: input.audit.ipAddress ?? null,
                userAgent: input.audit.userAgent ?? null,
            },
        });
    }

    private async findActivityByPublicIdInTx(
        tx: Tx,
        publicId: string
    ): Promise<TourismActivityListRow | null> {
        const rows = await tx.$queryRaw<TourismActivityListRow[]>(Prisma.sql`
            SELECT
                a.id AS "id",
                a.public_id::text AS "publicId",
                a.name,
                a.short_description AS "shortDescription",
                t.code AS "activityTypeCode",
                t.name_en AS "activityTypeNameEn",
                a.admin_area_id AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                p.public_id::text AS "primaryPlacePublicId",
                COALESCE(p.display_name, p.primary_name) AS "primaryPlaceName",
                a.is_active AS "isActive",
                a.is_verified AS "isVerified",
                a.season_mode AS "seasonMode",
                a.season_start_month AS "seasonStartMonth",
                a.season_end_month AS "seasonEndMonth",
                a.display_priority AS "displayPriority",
                a.requires_schedule_review AS "requiresScheduleReview",
                a.last_schedule_reviewed_at AS "lastScheduleReviewedAt",
                a.next_review_due_at AS "nextReviewDueAt",
                a.schedule_review_note AS "scheduleReviewNote",
                a.created_at AS "createdAt",
                a.updated_at AS "updatedAt"
            FROM tourism.activities AS a
            JOIN ref.ref_activity_types AS t ON t.id = a.activity_type_id
            JOIN core.core_admin_areas AS aa ON aa.id = a.admin_area_id
            LEFT JOIN core.core_places AS p ON p.id = a.primary_place_id
            WHERE a.public_id::text = ${publicId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    private async findEventByPublicIdInTx(
        tx: Tx,
        publicId: string
    ): Promise<TourismEventListRow | null> {
        const now = new Date();
        const rows = await tx.$queryRaw<TourismEventListRow[]>(Prisma.sql`
            SELECT
                e.id AS "id",
                e.public_id::text AS "publicId",
                e.name,
                e.short_description AS "shortDescription",
                t.code AS "eventTypeCode",
                t.name_en AS "eventTypeNameEn",
                e.admin_area_id AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                p.public_id::text AS "primaryPlacePublicId",
                COALESCE(p.display_name, p.primary_name) AS "primaryPlaceName",
                e.is_active AS "isActive",
                e.is_verified AS "isVerified",
                e.requires_schedule_review AS "requiresScheduleReview",
                e.last_schedule_reviewed_at AS "lastScheduleReviewedAt",
                e.next_review_due_at AS "nextReviewDueAt",
                e.schedule_review_note AS "scheduleReviewNote",
                nxt.starts_at AS "nextOccurrenceStartsAt",
                nxt.ends_at AS "nextOccurrenceEndsAt",
                nxt.status AS "nextOccurrenceStatus",
                nxt.public_id::text AS "nextOccurrencePublicId",
                e.created_at AS "createdAt",
                e.updated_at AS "updatedAt"
            FROM tourism.events AS e
            JOIN ref.ref_event_types AS t ON t.id = e.event_type_id
            JOIN core.core_admin_areas AS aa ON aa.id = e.admin_area_id
            LEFT JOIN core.core_places AS p ON p.id = e.primary_place_id
            LEFT JOIN LATERAL (
                SELECT o.starts_at, o.ends_at, o.status, o.public_id
                FROM tourism.event_occurrences AS o
                WHERE o.event_id = e.id
                  AND o.status IN ('scheduled', 'confirmed')
                  AND o.starts_at > ${now}
                ORDER BY o.starts_at ASC
                LIMIT 1
            ) AS nxt ON true
            WHERE e.public_id::text = ${publicId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    private async findOccurrenceByPublicIdInTx(
        tx: Tx,
        publicId: string
    ): Promise<TourismOccurrenceRow | null> {
        const rows = await tx.$queryRaw<TourismOccurrenceRow[]>(Prisma.sql`
            SELECT
                o.id AS "id",
                o.public_id::text AS "publicId",
                o.event_id AS "eventId",
                e.public_id::text AS "eventPublicId",
                o.starts_at AS "startsAt",
                o.ends_at AS "endsAt",
                o.status,
                o.schedule_note AS "scheduleNote",
                o.source_url AS "sourceUrl",
                o.verified_at AS "verifiedAt",
                o.created_at AS "createdAt",
                o.updated_at AS "updatedAt"
            FROM tourism.event_occurrences AS o
            JOIN tourism.events AS e ON e.id = o.event_id
            WHERE o.public_id::text = ${publicId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    // -------------------------------------------------------------------------
    // Public Discover lists (active only; unverified allowed, sorted verified first)
    // -------------------------------------------------------------------------

    async listPublicActivities(input: {
        adminAreaId?: bigint;
        activityTypeCode?: string;
        limit: number;
        offset: number;
    }): Promise<{ rows: TourismActivityListRow[]; total: number }> {
        const filters: Prisma.Sql[] = [Prisma.sql`a.is_active = true`];
        if (input.adminAreaId !== undefined) {
            filters.push(Prisma.sql`a.admin_area_id = ${input.adminAreaId}`);
        }
        if (input.activityTypeCode) {
            filters.push(Prisma.sql`t.code = ${input.activityTypeCode}`);
        }
        const whereSql = Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM tourism.activities AS a
            JOIN ref.ref_activity_types AS t ON t.id = a.activity_type_id
            ${whereSql}
        `);
        const total = Number(countRows[0]?.count ?? 0n);

        const rows = await this.prisma.$queryRaw<TourismActivityListRow[]>(Prisma.sql`
            SELECT
                a.id AS "id",
                a.public_id::text AS "publicId",
                a.name,
                a.short_description AS "shortDescription",
                t.code AS "activityTypeCode",
                t.name_en AS "activityTypeNameEn",
                a.admin_area_id AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                p.public_id::text AS "primaryPlacePublicId",
                COALESCE(p.display_name, p.primary_name) AS "primaryPlaceName",
                a.is_active AS "isActive",
                a.is_verified AS "isVerified",
                a.season_mode AS "seasonMode",
                a.season_start_month AS "seasonStartMonth",
                a.season_end_month AS "seasonEndMonth",
                a.display_priority AS "displayPriority",
                false AS "requiresScheduleReview",
                NULL::timestamptz AS "lastScheduleReviewedAt",
                NULL::timestamptz AS "nextReviewDueAt",
                NULL::text AS "scheduleReviewNote",
                a.created_at AS "createdAt",
                a.updated_at AS "updatedAt",
                p.lat::double precision AS "primaryPlaceLat",
                p.lng::double precision AS "primaryPlaceLng"
            FROM tourism.activities AS a
            JOIN ref.ref_activity_types AS t ON t.id = a.activity_type_id
            JOIN core.core_admin_areas AS aa ON aa.id = a.admin_area_id
            LEFT JOIN core.core_places AS p
                ON p.id = a.primary_place_id
               AND p.deleted_at IS NULL
               AND p.is_public = true
            ${whereSql}
            ORDER BY a.is_verified DESC, a.display_priority DESC, a.name ASC, a.id ASC
            LIMIT ${input.limit}
            OFFSET ${input.offset}
        `);

        return { rows, total };
    }

    async listPublicEventOccurrences(input: {
        kind: "happening_now" | "upcoming";
        adminAreaId?: bigint;
        eventTypeCode?: string;
        limit: number;
        offset: number;
        now: Date;
    }): Promise<{ rows: TourismPublicEventOccurrenceRow[]; total: number }> {
        const filters: Prisma.Sql[] = [
            Prisma.sql`e.is_active = true`,
            Prisma.sql`o.status <> 'cancelled'`,
        ];
        if (input.kind === "happening_now") {
            filters.push(Prisma.sql`o.status = 'confirmed'`);
            filters.push(Prisma.sql`o.starts_at <= ${input.now}`);
            filters.push(Prisma.sql`o.ends_at >= ${input.now}`);
        } else {
            filters.push(Prisma.sql`o.status IN ('scheduled', 'confirmed')`);
            filters.push(Prisma.sql`o.starts_at > ${input.now}`);
        }
        if (input.adminAreaId !== undefined) {
            filters.push(Prisma.sql`e.admin_area_id = ${input.adminAreaId}`);
        }
        if (input.eventTypeCode) {
            filters.push(Prisma.sql`t.code = ${input.eventTypeCode}`);
        }
        const whereSql = Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;
        const orderSql =
            input.kind === "happening_now"
                ? Prisma.sql`ORDER BY o.starts_at ASC, e.name ASC, o.id ASC`
                : Prisma.sql`ORDER BY o.starts_at ASC, e.name ASC, o.id ASC`;

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM tourism.event_occurrences AS o
            JOIN tourism.events AS e ON e.id = o.event_id
            JOIN ref.ref_event_types AS t ON t.id = e.event_type_id
            ${whereSql}
        `);
        const total = Number(countRows[0]?.count ?? 0n);

        const rows = await this.prisma.$queryRaw<TourismPublicEventOccurrenceRow[]>(Prisma.sql`
            SELECT
                e.public_id::text AS "eventPublicId",
                e.name AS "eventName",
                e.short_description AS "eventShortDescription",
                e.is_verified AS "eventIsVerified",
                t.code AS "eventTypeCode",
                t.name_en AS "eventTypeNameEn",
                aa.canonical_name AS "adminAreaName",
                p.public_id::text AS "primaryPlacePublicId",
                COALESCE(p.display_name, p.primary_name) AS "primaryPlaceName",
                p.lat::double precision AS "primaryPlaceLat",
                p.lng::double precision AS "primaryPlaceLng",
                o.public_id::text AS "occurrencePublicId",
                o.starts_at AS "startsAt",
                o.ends_at AS "endsAt",
                o.status AS "occurrenceStatus",
                o.schedule_note AS "scheduleNote"
            FROM tourism.event_occurrences AS o
            JOIN tourism.events AS e ON e.id = o.event_id
            JOIN ref.ref_event_types AS t ON t.id = e.event_type_id
            JOIN core.core_admin_areas AS aa ON aa.id = e.admin_area_id
            LEFT JOIN core.core_places AS p
                ON p.id = e.primary_place_id
               AND p.deleted_at IS NULL
               AND p.is_public = true
            ${whereSql}
            ${orderSql}
            LIMIT ${input.limit}
            OFFSET ${input.offset}
        `);

        return { rows, total };
    }
}

export type TourismPublicEventOccurrenceRow = {
    eventPublicId: string;
    eventName: string;
    eventShortDescription: string | null;
    eventIsVerified: boolean;
    eventTypeCode: string;
    eventTypeNameEn: string;
    adminAreaName: string;
    primaryPlacePublicId: string | null;
    primaryPlaceName: string | null;
    primaryPlaceLat: number | null;
    primaryPlaceLng: number | null;
    occurrencePublicId: string;
    startsAt: Date;
    endsAt: Date;
    occurrenceStatus: string;
    scheduleNote: string | null;
};
