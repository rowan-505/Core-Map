/**
 * Admin tourism activities / events / occurrences service.
 */
import { TourismReviewsError } from "./tourism.errors.js";
import {
    enrichOccurrence,
    type TourismEventOccurrenceInput,
} from "./tourism.event-occurrences.js";
import type {
    ConfirmTourismScheduleReviewBody,
    CreateTourismActivityBody,
    CreateTourismEventBody,
    CreateTourismOccurrenceBody,
    ListAdminTourismActivitiesQuery,
    ListAdminTourismEventsQuery,
    ListPublicTourismActivitiesQuery,
    ListPublicTourismEventsQuery,
    ListTourismOccurrencesQuery,
    UpdateTourismActivityBody,
    UpdateTourismEventBody,
    UpdateTourismOccurrenceBody,
} from "./tourism.catalog.schema.js";
import {
    TourismCatalogRepository,
    type CatalogAuditContext,
    type TourismActivityListRow,
    type TourismEventListRow,
    type TourismOccurrenceRow,
    type TourismPublicEventOccurrenceRow,
} from "./tourism.catalog.repo.js";
import {
    deriveScheduleReviewState,
    isScheduleNeedsReview,
    type TourismScheduleReviewState,
} from "./tourism.schedule-review.js";

export type TourismCatalogTypeDto = {
    code: string;
    name_en: string;
    name_mm: string | null;
    sort_order: number;
};

export type TourismActivityAdminDto = {
    public_id: string;
    name: string;
    short_description: string | null;
    activity_type: string;
    activity_type_name_en: string;
    admin_area_id: string;
    admin_area_name: string;
    primary_place_public_id: string | null;
    primary_place_name: string | null;
    is_active: boolean;
    is_verified: boolean;
    season_mode: string;
    season_start_month: number | null;
    season_end_month: number | null;
    display_priority: number;
    requires_schedule_review: boolean;
    last_schedule_reviewed_at: string | null;
    next_review_due_at: string | null;
    schedule_review_note: string | null;
    review_status: TourismScheduleReviewState;
    needs_review: boolean;
    created_at: string;
    updated_at: string;
};

export type TourismEventAdminDto = {
    public_id: string;
    name: string;
    short_description: string | null;
    event_type: string;
    event_type_name_en: string;
    admin_area_id: string;
    admin_area_name: string;
    primary_place_public_id: string | null;
    primary_place_name: string | null;
    is_active: boolean;
    is_verified: boolean;
    requires_schedule_review: boolean;
    last_schedule_reviewed_at: string | null;
    next_review_due_at: string | null;
    schedule_review_note: string | null;
    review_status: TourismScheduleReviewState;
    needs_review: boolean;
    missing_next_occurrence: boolean;
    next_occurrence: {
        public_id: string;
        starts_at: string;
        ends_at: string;
        status: string;
    } | null;
    last_occurrence: {
        public_id: string;
        starts_at: string;
        ends_at: string;
        status: string;
    } | null;
    created_at: string;
    updated_at: string;
};

export type TourismOccurrenceAdminDto = {
    public_id: string;
    event_public_id: string;
    starts_at: string;
    ends_at: string;
    status: string;
    schedule_note: string | null;
    source_url: string | null;
    verified_at: string | null;
    derived_state: string;
    duration_seconds: number;
    duration_days: number;
    created_at: string;
    updated_at: string;
};

/** Public Discover activity card — no admin/audit fields. */
export type TourismActivityPublicDto = {
    public_id: string;
    name: string;
    short_description: string | null;
    activity_type: string;
    activity_type_name_en: string;
    admin_area_name: string;
    is_verified: boolean;
    season_mode: string;
    season_start_month: number | null;
    season_end_month: number | null;
    display_priority: number;
    primary_place: {
        public_id: string;
        name: string;
        lat: number | null;
        lng: number | null;
    } | null;
};

/** Public Discover event + occurrence card. */
export type TourismEventPublicDto = {
    public_id: string;
    name: string;
    short_description: string | null;
    event_type: string;
    event_type_name_en: string;
    admin_area_name: string;
    is_verified: boolean;
    primary_place: {
        public_id: string;
        name: string;
        lat: number | null;
        lng: number | null;
    } | null;
    occurrence: {
        public_id: string;
        starts_at: string;
        ends_at: string;
        status: string;
        schedule_note: string | null;
        derived_state: string;
        duration_days: number;
    };
};

export class TourismCatalogService {
    constructor(private readonly repo: TourismCatalogRepository) {}

    async listPublicActivities(query: ListPublicTourismActivitiesQuery) {
        const { rows, total } = await this.repo.listPublicActivities({
            adminAreaId: query.admin_area_id ? BigInt(query.admin_area_id) : undefined,
            activityTypeCode: query.activity_type,
            limit: query.limit,
            offset: query.offset,
        });
        return {
            items: rows.map((row) => this.toPublicActivityDto(row)),
            total,
            limit: query.limit,
            offset: query.offset,
        };
    }

    async listPublicEvents(query: ListPublicTourismEventsQuery) {
        const now = new Date();
        const { rows, total } = await this.repo.listPublicEventOccurrences({
            kind: query.status,
            adminAreaId: query.admin_area_id ? BigInt(query.admin_area_id) : undefined,
            eventTypeCode: query.event_type,
            limit: query.limit,
            offset: query.offset,
            now,
        });
        return {
            status: query.status,
            items: rows.map((row) => this.toPublicEventDto(row, now)),
            total,
            limit: query.limit,
            offset: query.offset,
        };
    }

    async listActivityTypes(): Promise<TourismCatalogTypeDto[]> {
        const rows = await this.repo.listActivityTypes();
        return rows.map((row) => ({
            code: row.code,
            name_en: row.nameEn,
            name_mm: row.nameMm,
            sort_order: row.sortOrder,
        }));
    }

    async listEventTypes(): Promise<TourismCatalogTypeDto[]> {
        const rows = await this.repo.listEventTypes();
        return rows.map((row) => ({
            code: row.code,
            name_en: row.nameEn,
            name_mm: row.nameMm,
            sort_order: row.sortOrder,
        }));
    }

    async listActivities(query: ListAdminTourismActivitiesQuery) {
        const now = new Date();
        const { rows, total } = await this.repo.listActivities({
            adminAreaId: query.admin_area_id ? BigInt(query.admin_area_id) : undefined,
            activityTypeCode: query.activity_type,
            isActive: query.is_active,
            isVerified: query.is_verified,
            q: query.q,
            reviewStatus: query.review_status,
            limit: query.limit,
            offset: query.offset,
            now,
        });
        return {
            items: rows.map((row) => this.toActivityDto(row, now)),
            total,
            limit: query.limit,
            offset: query.offset,
        };
    }

    async getActivity(publicId: string): Promise<TourismActivityAdminDto> {
        const row = await this.repo.findActivityByPublicId(publicId);
        if (!row) {
            throw new TourismReviewsError("Activity not found", 404, "ACTIVITY_NOT_FOUND");
        }
        return this.toActivityDto(row);
    }

    async createActivity(
        actorPublicId: string,
        body: CreateTourismActivityBody,
        audit: CatalogAuditContext
    ): Promise<TourismActivityAdminDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const activityTypeId = await this.requireActivityType(body.activity_type);
        const adminAreaId = await this.requireAdminArea(body.admin_area_id);
        const primaryPlaceId = await this.resolveOptionalPlace(body.primary_place_public_id);

        const row = await this.repo.createActivity({
            actorUserId,
            name: body.name,
            shortDescription: body.short_description ?? null,
            activityTypeId,
            adminAreaId,
            primaryPlaceId,
            seasonMode: body.season_mode,
            seasonStartMonth: body.season_start_month ?? null,
            seasonEndMonth: body.season_end_month ?? null,
            displayPriority: body.display_priority,
            isActive: body.is_active,
            isVerified: body.is_verified,
            requiresScheduleReview: body.requires_schedule_review,
            lastScheduleReviewedAt: null,
            nextReviewDueAt: null,
            scheduleReviewNote: null,
            audit,
            afterSnapshot: this.activitySnapshotFromBody(body),
        });
        return this.toActivityDto(row);
    }

    async updateActivity(
        actorPublicId: string,
        publicId: string,
        body: UpdateTourismActivityBody,
        audit: CatalogAuditContext
    ): Promise<TourismActivityAdminDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const existing = await this.repo.findActivityByPublicId(publicId);
        if (!existing) {
            throw new TourismReviewsError("Activity not found", 404, "ACTIVITY_NOT_FOUND");
        }

        const data: Parameters<TourismCatalogRepository["updateActivity"]>[0]["data"] = {};
        if (body.name !== undefined) data.name = body.name;
        if (body.short_description !== undefined) data.shortDescription = body.short_description;
        if (body.activity_type !== undefined) {
            data.activityTypeId = await this.requireActivityType(body.activity_type);
        }
        if (body.admin_area_id !== undefined) {
            data.adminAreaId = await this.requireAdminArea(body.admin_area_id);
        }
        if (body.primary_place_public_id !== undefined) {
            data.primaryPlaceId = await this.resolveOptionalPlace(body.primary_place_public_id);
        }
        if (body.season_mode !== undefined) data.seasonMode = body.season_mode;
        if (body.season_start_month !== undefined) data.seasonStartMonth = body.season_start_month;
        if (body.season_end_month !== undefined) data.seasonEndMonth = body.season_end_month;
        if (body.display_priority !== undefined) data.displayPriority = body.display_priority;
        if (body.is_active !== undefined) data.isActive = body.is_active;
        if (body.is_verified !== undefined) data.isVerified = body.is_verified;
        if (body.requires_schedule_review !== undefined) {
            data.requiresScheduleReview = body.requires_schedule_review;
        }

        const actionType = this.resolveActivityAuditAction(existing, body);
        const row = await this.repo.updateActivity({
            activityId: existing.id,
            publicId,
            actorUserId,
            data,
            beforeSnapshot: this.activitySnapshotFromRow(existing),
            afterSnapshot: {
                ...this.activitySnapshotFromRow(existing),
                ...this.activitySnapshotFromBody(body),
            },
            audit,
            actionType,
        });
        return this.toActivityDto(row);
    }

    async listEvents(query: ListAdminTourismEventsQuery) {
        const now = new Date();
        const { rows, total } = await this.repo.listEvents({
            adminAreaId: query.admin_area_id ? BigInt(query.admin_area_id) : undefined,
            eventTypeCode: query.event_type,
            isActive: query.is_active,
            isVerified: query.is_verified,
            q: query.q,
            upcomingOnly: query.tab === "upcoming",
            reviewStatus: query.review_status,
            limit: query.limit,
            offset: query.offset,
            now,
        });
        return {
            items: rows.map((row) => this.toEventDto(row, now)),
            total,
            limit: query.limit,
            offset: query.offset,
            tab: query.tab,
        };
    }

    async getEvent(publicId: string): Promise<TourismEventAdminDto> {
        const row = await this.repo.findEventByPublicId(publicId);
        if (!row) {
            throw new TourismReviewsError("Event not found", 404, "EVENT_NOT_FOUND");
        }
        return this.toEventDto(row);
    }

    async createEvent(
        actorPublicId: string,
        body: CreateTourismEventBody,
        audit: CatalogAuditContext
    ): Promise<TourismEventAdminDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const eventTypeId = await this.requireEventType(body.event_type);
        const adminAreaId = await this.requireAdminArea(body.admin_area_id);
        const primaryPlaceId = await this.resolveOptionalPlace(body.primary_place_public_id);

        const row = await this.repo.createEvent({
            actorUserId,
            name: body.name,
            shortDescription: body.short_description ?? null,
            eventTypeId,
            adminAreaId,
            primaryPlaceId,
            isActive: body.is_active,
            isVerified: body.is_verified,
            requiresScheduleReview: body.requires_schedule_review,
            lastScheduleReviewedAt: null,
            nextReviewDueAt: null,
            scheduleReviewNote: null,
            audit,
            afterSnapshot: this.eventSnapshotFromBody(body),
        });
        return this.toEventDto(row);
    }

    async updateEvent(
        actorPublicId: string,
        publicId: string,
        body: UpdateTourismEventBody,
        audit: CatalogAuditContext
    ): Promise<TourismEventAdminDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const existing = await this.repo.findEventByPublicId(publicId);
        if (!existing) {
            throw new TourismReviewsError("Event not found", 404, "EVENT_NOT_FOUND");
        }

        const data: Parameters<TourismCatalogRepository["updateEvent"]>[0]["data"] = {};
        if (body.name !== undefined) data.name = body.name;
        if (body.short_description !== undefined) data.shortDescription = body.short_description;
        if (body.event_type !== undefined) {
            data.eventTypeId = await this.requireEventType(body.event_type);
        }
        if (body.admin_area_id !== undefined) {
            data.adminAreaId = await this.requireAdminArea(body.admin_area_id);
        }
        if (body.primary_place_public_id !== undefined) {
            data.primaryPlaceId = await this.resolveOptionalPlace(body.primary_place_public_id);
        }
        if (body.is_active !== undefined) data.isActive = body.is_active;
        if (body.is_verified !== undefined) data.isVerified = body.is_verified;
        if (body.requires_schedule_review !== undefined) {
            data.requiresScheduleReview = body.requires_schedule_review;
        }

        const actionType = this.resolveEventAuditAction(existing, body);
        const row = await this.repo.updateEvent({
            eventId: existing.id,
            publicId,
            actorUserId,
            data,
            beforeSnapshot: this.eventSnapshotFromRow(existing),
            afterSnapshot: {
                ...this.eventSnapshotFromRow(existing),
                ...this.eventSnapshotFromBody(body),
            },
            audit,
            actionType,
        });
        return this.toEventDto(row);
    }

    async confirmActivityScheduleReview(
        actorPublicId: string,
        publicId: string,
        body: ConfirmTourismScheduleReviewBody,
        audit: CatalogAuditContext
    ): Promise<TourismActivityAdminDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const existing = await this.repo.findActivityByPublicId(publicId);
        if (!existing) {
            throw new TourismReviewsError("Activity not found", 404, "ACTIVITY_NOT_FOUND");
        }
        const row = await this.repo.confirmActivityScheduleReview({
            activityId: existing.id,
            publicId,
            actorUserId,
            nextReviewDueAt: new Date(body.next_review_due_at),
            scheduleReviewNote: body.schedule_review_note ?? null,
            requiresScheduleReview: body.requires_schedule_review,
            beforeSnapshot: this.activitySnapshotFromRow(existing),
            audit,
        });
        return this.toActivityDto(row);
    }

    async confirmEventScheduleReview(
        actorPublicId: string,
        publicId: string,
        body: ConfirmTourismScheduleReviewBody,
        audit: CatalogAuditContext
    ): Promise<TourismEventAdminDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const existing = await this.repo.findEventByPublicId(publicId);
        if (!existing) {
            throw new TourismReviewsError("Event not found", 404, "EVENT_NOT_FOUND");
        }
        const row = await this.repo.confirmEventScheduleReview({
            eventId: existing.id,
            publicId,
            actorUserId,
            nextReviewDueAt: new Date(body.next_review_due_at),
            scheduleReviewNote: body.schedule_review_note ?? null,
            requiresScheduleReview: body.requires_schedule_review,
            beforeSnapshot: this.eventSnapshotFromRow(existing),
            audit,
        });
        return this.toEventDto(row);
    }

    async listOccurrences(
        eventPublicId: string,
        query: ListTourismOccurrencesQuery
    ) {
        const event = await this.repo.findEventByPublicId(eventPublicId);
        if (!event) {
            throw new TourismReviewsError("Event not found", 404, "EVENT_NOT_FOUND");
        }
        const { rows, total } = await this.repo.listOccurrencesForEvent({
            eventId: event.id,
            limit: query.limit,
            offset: query.offset,
        });
        const now = new Date();
        return {
            items: rows.map((row) => this.toOccurrenceDto(row, now)),
            total,
            limit: query.limit,
            offset: query.offset,
        };
    }

    async createOccurrence(
        actorPublicId: string,
        eventPublicId: string,
        body: CreateTourismOccurrenceBody,
        audit: CatalogAuditContext
    ): Promise<TourismOccurrenceAdminDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const event = await this.repo.findEventByPublicId(eventPublicId);
        if (!event) {
            throw new TourismReviewsError("Event not found", 404, "EVENT_NOT_FOUND");
        }

        const startsAt = new Date(body.starts_at);
        const endsAt = new Date(body.ends_at);
        this.assertOccurrenceRange(startsAt, endsAt);

        const row = await this.repo.createOccurrence({
            actorUserId,
            eventId: event.id,
            startsAt,
            endsAt,
            status: body.status,
            scheduleNote: body.schedule_note ?? null,
            sourceUrl: body.source_url ?? null,
            verifiedAt: parseOptionalDate(body.verified_at),
            audit,
            afterSnapshot: {
                event_public_id: eventPublicId,
                starts_at: startsAt.toISOString(),
                ends_at: endsAt.toISOString(),
                status: body.status,
                schedule_note: body.schedule_note ?? null,
                source_url: body.source_url ?? null,
            },
        });
        return this.toOccurrenceDto(row);
    }

    async updateOccurrence(
        actorPublicId: string,
        eventPublicId: string,
        occurrencePublicId: string,
        body: UpdateTourismOccurrenceBody,
        audit: CatalogAuditContext
    ): Promise<TourismOccurrenceAdminDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const event = await this.repo.findEventByPublicId(eventPublicId);
        if (!event) {
            throw new TourismReviewsError("Event not found", 404, "EVENT_NOT_FOUND");
        }
        const existing = await this.repo.findOccurrenceByPublicId(occurrencePublicId);
        if (!existing || existing.eventId !== event.id) {
            throw new TourismReviewsError(
                "Occurrence not found for this event",
                404,
                "OCCURRENCE_NOT_FOUND"
            );
        }

        const startsAt =
            body.starts_at !== undefined ? new Date(body.starts_at) : existing.startsAt;
        const endsAt = body.ends_at !== undefined ? new Date(body.ends_at) : existing.endsAt;
        this.assertOccurrenceRange(startsAt, endsAt);

        const data: Parameters<TourismCatalogRepository["updateOccurrence"]>[0]["data"] = {};
        if (body.starts_at !== undefined) data.startsAt = startsAt;
        if (body.ends_at !== undefined) data.endsAt = endsAt;
        if (body.status !== undefined) data.status = body.status;
        if (body.schedule_note !== undefined) data.scheduleNote = body.schedule_note;
        if (body.source_url !== undefined) data.sourceUrl = body.source_url;
        if (body.verified_at !== undefined) data.verifiedAt = parseOptionalDate(body.verified_at);

        const actionType = this.resolveOccurrenceAuditAction(existing, body);
        const row = await this.repo.updateOccurrence({
            occurrenceId: existing.id,
            publicId: occurrencePublicId,
            actorUserId,
            data,
            beforeSnapshot: this.occurrenceSnapshotFromRow(existing),
            afterSnapshot: {
                ...this.occurrenceSnapshotFromRow(existing),
                ...(body.starts_at !== undefined ? { starts_at: startsAt.toISOString() } : {}),
                ...(body.ends_at !== undefined ? { ends_at: endsAt.toISOString() } : {}),
                ...(body.status !== undefined ? { status: body.status } : {}),
                ...(body.schedule_note !== undefined
                    ? { schedule_note: body.schedule_note }
                    : {}),
                ...(body.source_url !== undefined ? { source_url: body.source_url } : {}),
            },
            audit,
            actionType,
        });
        return this.toOccurrenceDto(row);
    }

    private assertOccurrenceRange(startsAt: Date, endsAt: Date): void {
        if (!(endsAt.getTime() > startsAt.getTime())) {
            throw new TourismReviewsError(
                "ends_at must be after starts_at",
                400,
                "INVALID_OCCURRENCE_RANGE"
            );
        }
    }

    private async requireUsableUser(publicId: string): Promise<bigint> {
        const userId = await this.repo.findUsableUserIdByPublicId(publicId);
        if (!userId) {
            throw new TourismReviewsError("User account is inactive", 403, "INACTIVE_USER");
        }
        return userId;
    }

    private async requireActivityType(code: string): Promise<bigint> {
        const id = await this.repo.findActiveActivityTypeIdByCode(code);
        if (!id) {
            throw new TourismReviewsError(
                "Invalid or inactive activity type",
                400,
                "INVALID_ACTIVITY_TYPE"
            );
        }
        return id;
    }

    private async requireEventType(code: string): Promise<bigint> {
        const id = await this.repo.findActiveEventTypeIdByCode(code);
        if (!id) {
            throw new TourismReviewsError(
                "Invalid or inactive event type",
                400,
                "INVALID_EVENT_TYPE"
            );
        }
        return id;
    }

    private async requireAdminArea(adminAreaId: string): Promise<bigint> {
        const id = await this.repo.findActiveAdminAreaId(BigInt(adminAreaId));
        if (!id) {
            throw new TourismReviewsError(
                "Invalid or inactive admin area",
                400,
                "INVALID_ADMIN_AREA"
            );
        }
        return id;
    }

    private async resolveOptionalPlace(
        publicId: string | null | undefined
    ): Promise<bigint | null> {
        if (publicId === undefined || publicId === null) {
            return null;
        }
        const placeId = await this.repo.findActivePlaceIdByPublicId(publicId);
        if (!placeId) {
            throw new TourismReviewsError("Place not found", 404, "PLACE_NOT_FOUND");
        }
        return placeId;
    }

    private resolveActivityAuditAction(
        before: TourismActivityListRow,
        body: UpdateTourismActivityBody
    ): string {
        if (body.is_verified !== undefined && body.is_verified !== before.isVerified) {
            return body.is_verified
                ? "tourism_activity_verified"
                : "tourism_activity_unverified";
        }
        if (body.is_active !== undefined && body.is_active !== before.isActive) {
            return body.is_active
                ? "tourism_activity_activated"
                : "tourism_activity_deactivated";
        }
        return "tourism_activity_updated";
    }

    private resolveEventAuditAction(
        before: TourismEventListRow,
        body: UpdateTourismEventBody
    ): string {
        if (body.is_verified !== undefined && body.is_verified !== before.isVerified) {
            return body.is_verified ? "tourism_event_verified" : "tourism_event_unverified";
        }
        if (body.is_active !== undefined && body.is_active !== before.isActive) {
            return body.is_active ? "tourism_event_activated" : "tourism_event_deactivated";
        }
        return "tourism_event_updated";
    }

    private resolveOccurrenceAuditAction(
        before: TourismOccurrenceRow,
        body: UpdateTourismOccurrenceBody
    ): string {
        if (body.status !== undefined && body.status !== before.status) {
            return `tourism_event_occurrence_status_${body.status}`;
        }
        if (body.starts_at !== undefined || body.ends_at !== undefined) {
            return "tourism_event_occurrence_dates_updated";
        }
        return "tourism_event_occurrence_updated";
    }

    private toActivityDto(
        row: TourismActivityListRow,
        now: Date = new Date()
    ): TourismActivityAdminDto {
        const reviewStatus = deriveScheduleReviewState(
            {
                requiresScheduleReview: row.requiresScheduleReview,
                nextReviewDueAt: row.nextReviewDueAt,
            },
            now
        );
        return {
            public_id: row.publicId,
            name: row.name,
            short_description: row.shortDescription,
            activity_type: row.activityTypeCode,
            activity_type_name_en: row.activityTypeNameEn,
            admin_area_id: String(row.adminAreaId),
            admin_area_name: row.adminAreaName,
            primary_place_public_id: row.primaryPlacePublicId,
            primary_place_name: row.primaryPlaceName,
            is_active: row.isActive,
            is_verified: row.isVerified,
            season_mode: row.seasonMode,
            season_start_month: row.seasonStartMonth,
            season_end_month: row.seasonEndMonth,
            display_priority: row.displayPriority,
            requires_schedule_review: row.requiresScheduleReview,
            last_schedule_reviewed_at: row.lastScheduleReviewedAt?.toISOString() ?? null,
            next_review_due_at: row.nextReviewDueAt?.toISOString() ?? null,
            schedule_review_note: row.scheduleReviewNote,
            review_status: reviewStatus,
            needs_review: isScheduleNeedsReview({ reviewState: reviewStatus }),
            created_at: row.createdAt.toISOString(),
            updated_at: row.updatedAt.toISOString(),
        };
    }

    private toPublicActivityDto(row: TourismActivityListRow): TourismActivityPublicDto {
        return {
            public_id: row.publicId,
            name: row.name,
            short_description: row.shortDescription,
            activity_type: row.activityTypeCode,
            activity_type_name_en: row.activityTypeNameEn,
            admin_area_name: row.adminAreaName,
            is_verified: row.isVerified,
            season_mode: row.seasonMode,
            season_start_month: row.seasonStartMonth,
            season_end_month: row.seasonEndMonth,
            display_priority: row.displayPriority,
            primary_place:
                row.primaryPlacePublicId && row.primaryPlaceName
                    ? {
                          public_id: row.primaryPlacePublicId,
                          name: row.primaryPlaceName,
                          lat: row.primaryPlaceLat ?? null,
                          lng: row.primaryPlaceLng ?? null,
                      }
                    : null,
        };
    }

    private toPublicEventDto(
        row: TourismPublicEventOccurrenceRow,
        now: Date
    ): TourismEventPublicDto {
        const enriched = enrichOccurrence(
            {
                id: row.occurrencePublicId,
                eventId: row.eventPublicId,
                startsAt: row.startsAt,
                endsAt: row.endsAt,
                status: row.occurrenceStatus,
                scheduleNote: row.scheduleNote,
            },
            now
        );
        return {
            public_id: row.eventPublicId,
            name: row.eventName,
            short_description: row.eventShortDescription,
            event_type: row.eventTypeCode,
            event_type_name_en: row.eventTypeNameEn,
            admin_area_name: row.adminAreaName,
            is_verified: row.eventIsVerified,
            primary_place:
                row.primaryPlacePublicId && row.primaryPlaceName
                    ? {
                          public_id: row.primaryPlacePublicId,
                          name: row.primaryPlaceName,
                          lat: row.primaryPlaceLat,
                          lng: row.primaryPlaceLng,
                      }
                    : null,
            occurrence: {
                public_id: row.occurrencePublicId,
                starts_at: row.startsAt.toISOString(),
                ends_at: row.endsAt.toISOString(),
                status: row.occurrenceStatus,
                schedule_note: row.scheduleNote,
                derived_state: enriched.derivedState,
                duration_days: enriched.durationDays,
            },
        };
    }

    private toEventDto(
        row: TourismEventListRow,
        now: Date = new Date()
    ): TourismEventAdminDto {
        const reviewStatus = deriveScheduleReviewState(
            {
                requiresScheduleReview: row.requiresScheduleReview,
                nextReviewDueAt: row.nextReviewDueAt,
            },
            now
        );
        const missingNextOccurrence = Boolean(row.missingNextOccurrence);
        return {
            public_id: row.publicId,
            name: row.name,
            short_description: row.shortDescription,
            event_type: row.eventTypeCode,
            event_type_name_en: row.eventTypeNameEn,
            admin_area_id: String(row.adminAreaId),
            admin_area_name: row.adminAreaName,
            primary_place_public_id: row.primaryPlacePublicId,
            primary_place_name: row.primaryPlaceName,
            is_active: row.isActive,
            is_verified: row.isVerified,
            requires_schedule_review: row.requiresScheduleReview,
            last_schedule_reviewed_at: row.lastScheduleReviewedAt?.toISOString() ?? null,
            next_review_due_at: row.nextReviewDueAt?.toISOString() ?? null,
            schedule_review_note: row.scheduleReviewNote,
            review_status: reviewStatus,
            missing_next_occurrence: missingNextOccurrence,
            needs_review: isScheduleNeedsReview({
                reviewState: reviewStatus,
                missingNextOccurrence,
            }),
            next_occurrence:
                row.nextOccurrencePublicId &&
                row.nextOccurrenceStartsAt &&
                row.nextOccurrenceEndsAt &&
                row.nextOccurrenceStatus
                    ? {
                          public_id: row.nextOccurrencePublicId,
                          starts_at: row.nextOccurrenceStartsAt.toISOString(),
                          ends_at: row.nextOccurrenceEndsAt.toISOString(),
                          status: row.nextOccurrenceStatus,
                      }
                    : null,
            last_occurrence:
                row.lastOccurrencePublicId &&
                row.lastOccurrenceStartsAt &&
                row.lastOccurrenceEndsAt &&
                row.lastOccurrenceStatus
                    ? {
                          public_id: row.lastOccurrencePublicId,
                          starts_at: row.lastOccurrenceStartsAt.toISOString(),
                          ends_at: row.lastOccurrenceEndsAt.toISOString(),
                          status: row.lastOccurrenceStatus,
                      }
                    : null,
            created_at: row.createdAt.toISOString(),
            updated_at: row.updatedAt.toISOString(),
        };
    }

    private toOccurrenceDto(
        row: TourismOccurrenceRow,
        now: Date = new Date()
    ): TourismOccurrenceAdminDto {
        const input: TourismEventOccurrenceInput = {
            id: row.id,
            publicId: row.publicId,
            eventId: row.eventId,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            status: row.status,
            scheduleNote: row.scheduleNote,
            sourceUrl: row.sourceUrl,
            verifiedAt: row.verifiedAt,
        };
        const enriched = enrichOccurrence(input, now);
        return {
            public_id: row.publicId,
            event_public_id: row.eventPublicId,
            starts_at: row.startsAt.toISOString(),
            ends_at: row.endsAt.toISOString(),
            status: row.status,
            schedule_note: row.scheduleNote,
            source_url: row.sourceUrl,
            verified_at: row.verifiedAt?.toISOString() ?? null,
            derived_state: enriched.derivedState,
            duration_seconds: enriched.durationSeconds,
            duration_days: enriched.durationDays,
            created_at: row.createdAt.toISOString(),
            updated_at: row.updatedAt.toISOString(),
        };
    }

    private activitySnapshotFromRow(row: TourismActivityListRow): Record<string, unknown> {
        return {
            name: row.name,
            activity_type: row.activityTypeCode,
            admin_area_id: String(row.adminAreaId),
            primary_place_public_id: row.primaryPlacePublicId,
            is_active: row.isActive,
            is_verified: row.isVerified,
            season_mode: row.seasonMode,
            display_priority: row.displayPriority,
        };
    }

    private activitySnapshotFromBody(
        body: CreateTourismActivityBody | UpdateTourismActivityBody
    ): Record<string, unknown> {
        const snap: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(body)) {
            if (value !== undefined) snap[key] = value;
        }
        return snap;
    }

    private eventSnapshotFromRow(row: TourismEventListRow): Record<string, unknown> {
        return {
            name: row.name,
            event_type: row.eventTypeCode,
            admin_area_id: String(row.adminAreaId),
            primary_place_public_id: row.primaryPlacePublicId,
            is_active: row.isActive,
            is_verified: row.isVerified,
        };
    }

    private eventSnapshotFromBody(
        body: CreateTourismEventBody | UpdateTourismEventBody
    ): Record<string, unknown> {
        const snap: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(body)) {
            if (value !== undefined) snap[key] = value;
        }
        return snap;
    }

    private occurrenceSnapshotFromRow(row: TourismOccurrenceRow): Record<string, unknown> {
        return {
            event_public_id: row.eventPublicId,
            starts_at: row.startsAt.toISOString(),
            ends_at: row.endsAt.toISOString(),
            status: row.status,
            schedule_note: row.scheduleNote,
            source_url: row.sourceUrl,
        };
    }
}

function parseOptionalDate(value: string | null | undefined): Date | null {
    if (value === undefined || value === null) return null;
    return new Date(value);
}
