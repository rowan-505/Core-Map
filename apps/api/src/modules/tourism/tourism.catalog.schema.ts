/**
 * Zod schemas for admin tourism activities / events / occurrences.
 */
import { z } from "zod";

import {
    TOURISM_ACTIVITY_NAME_MAX_LENGTH,
    TOURISM_ACTIVITY_SEASON_MODES,
    TOURISM_ACTIVITY_TYPE_CODES,
    TOURISM_EVENT_OCCURRENCE_STATUSES,
    TOURISM_EVENT_TYPE_CODES,
    TOURISM_OCCURRENCE_SCHEDULE_NOTE_MAX_LENGTH,
    TOURISM_OCCURRENCE_SOURCE_URL_MAX_LENGTH,
    TOURISM_SCHEDULE_REVIEW_NOTE_MAX_LENGTH,
    TOURISM_SHORT_DESCRIPTION_MAX_LENGTH,
} from "./tourism.types.js";

export const TOURISM_CATALOG_PAGE_SIZE = 20;
export const TOURISM_CATALOG_MAX_PAGE_SIZE = 50;

const uuidSchema = z.string().trim().uuid();
const bigintIdStringSchema = z
    .string()
    .trim()
    .regex(/^\d+$/, "Must be a numeric id");

const nullableTrimmedText = (max: number) =>
    z
        .string()
        .trim()
        .min(1, "Text must not be empty after trimming")
        .max(max)
        .nullable()
        .optional();

const booleanQuerySchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (value === true || value === "true" || value === "1") return true;
    if (value === false || value === "false" || value === "0") return false;
    return value;
}, z.boolean().optional());

const monthSchema = z.coerce.number().int().min(1).max(12);

const activitySeasonModeSchema = z.enum(TOURISM_ACTIVITY_SEASON_MODES);
const activityTypeCodeSchema = z.enum(TOURISM_ACTIVITY_TYPE_CODES);
const eventTypeCodeSchema = z.enum(TOURISM_EVENT_TYPE_CODES);
const occurrenceStatusSchema = z.enum(TOURISM_EVENT_OCCURRENCE_STATUSES);

function refineSeasonMonths<
    T extends {
        season_mode: string;
        season_start_month?: number | null;
        season_end_month?: number | null;
    },
>(data: T, ctx: z.RefinementCtx) {
    const start = data.season_start_month ?? null;
    const end = data.season_end_month ?? null;
    if (data.season_mode === "all_year" || data.season_mode === "temporarily_unavailable") {
        return;
    }
    if ((start === null) !== (end === null)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "season_start_month and season_end_month must both be set or both null",
            path: ["season_start_month"],
        });
    }
}

export const tourismActivityIdParamSchema = z.object({
    id: uuidSchema,
});

export const tourismEventIdParamSchema = z.object({
    id: uuidSchema,
});

export const tourismEventOccurrencesParamSchema = z.object({
    eventId: uuidSchema,
});

export const tourismEventOccurrenceIdParamSchema = z.object({
    eventId: uuidSchema,
    occurrenceId: uuidSchema,
});

export const listAdminTourismActivitiesQuerySchema = z.object({
    admin_area_id: bigintIdStringSchema.optional(),
    activity_type: activityTypeCodeSchema.optional(),
    is_active: booleanQuerySchema,
    is_verified: booleanQuerySchema,
    q: z.string().trim().min(1).max(200).optional(),
    review_status: z
        .enum(["current", "due_soon", "overdue", "needs_review"])
        .optional(),
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(TOURISM_CATALOG_MAX_PAGE_SIZE)
        .default(TOURISM_CATALOG_PAGE_SIZE),
    offset: z.coerce.number().int().min(0).default(0),
});

export type ListAdminTourismActivitiesQuery = z.infer<
    typeof listAdminTourismActivitiesQuerySchema
>;

export const listAdminTourismEventsQuerySchema = z.object({
    admin_area_id: bigintIdStringSchema.optional(),
    event_type: eventTypeCodeSchema.optional(),
    is_active: booleanQuerySchema,
    is_verified: booleanQuerySchema,
    q: z.string().trim().min(1).max(200).optional(),
    /** all = default; upcoming = has a future scheduled/confirmed occurrence */
    tab: z.enum(["all", "upcoming"]).default("all"),
    review_status: z
        .enum(["current", "due_soon", "overdue", "needs_review"])
        .optional(),
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(TOURISM_CATALOG_MAX_PAGE_SIZE)
        .default(TOURISM_CATALOG_PAGE_SIZE),
    offset: z.coerce.number().int().min(0).default(0),
});

export type ListAdminTourismEventsQuery = z.infer<typeof listAdminTourismEventsQuerySchema>;

export const confirmTourismScheduleReviewBodySchema = z
    .object({
        next_review_due_at: z.string().datetime({ offset: true }),
        schedule_review_note: nullableTrimmedText(TOURISM_SCHEDULE_REVIEW_NOTE_MAX_LENGTH),
        /** Defaults to true — confirming a review keeps the item on the schedule-review track. */
        requires_schedule_review: z.boolean().optional().default(true),
    })
    .strict();

export type ConfirmTourismScheduleReviewBody = z.infer<
    typeof confirmTourismScheduleReviewBodySchema
>;

const activityBodyBase = z.object({
    name: z.string().trim().min(1).max(TOURISM_ACTIVITY_NAME_MAX_LENGTH),
    short_description: nullableTrimmedText(TOURISM_SHORT_DESCRIPTION_MAX_LENGTH),
    activity_type: activityTypeCodeSchema,
    admin_area_id: bigintIdStringSchema,
    primary_place_public_id: uuidSchema.nullable().optional(),
    season_mode: activitySeasonModeSchema.default("all_year"),
    season_start_month: monthSchema.nullable().optional(),
    season_end_month: monthSchema.nullable().optional(),
    display_priority: z.coerce.number().int().min(-1000).max(1000).default(0),
    is_active: z.boolean().default(true),
    is_verified: z.boolean().default(false),
    /** Opt into schedule-review track. Due date / note only via schedule-review confirm. */
    requires_schedule_review: z.boolean().default(false),
});

export const createTourismActivityBodySchema = activityBodyBase.strict().superRefine(refineSeasonMonths);

export type CreateTourismActivityBody = z.infer<typeof createTourismActivityBodySchema>;

export const updateTourismActivityBodySchema = activityBodyBase
    .partial()
    .strict()
    .superRefine((data, ctx) => {
        if (data.season_mode !== undefined) {
            refineSeasonMonths(
                {
                    season_mode: data.season_mode,
                    season_start_month: data.season_start_month,
                    season_end_month: data.season_end_month,
                },
                ctx
            );
        }
    });

export type UpdateTourismActivityBody = z.infer<typeof updateTourismActivityBodySchema>;

const eventBodyBase = z.object({
    name: z.string().trim().min(1).max(TOURISM_ACTIVITY_NAME_MAX_LENGTH),
    short_description: nullableTrimmedText(TOURISM_SHORT_DESCRIPTION_MAX_LENGTH),
    event_type: eventTypeCodeSchema,
    admin_area_id: bigintIdStringSchema,
    primary_place_public_id: uuidSchema.nullable().optional(),
    is_active: z.boolean().default(true),
    is_verified: z.boolean().default(false),
    /** Opt into schedule-review track. Due date / note only via schedule-review confirm. */
    requires_schedule_review: z.boolean().default(false),
});

export const createTourismEventBodySchema = eventBodyBase.strict();
export type CreateTourismEventBody = z.infer<typeof createTourismEventBodySchema>;

export const updateTourismEventBodySchema = eventBodyBase.partial().strict();
export type UpdateTourismEventBody = z.infer<typeof updateTourismEventBodySchema>;

const occurrenceBodyBase = z.object({
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    status: occurrenceStatusSchema.default("scheduled"),
    schedule_note: nullableTrimmedText(TOURISM_OCCURRENCE_SCHEDULE_NOTE_MAX_LENGTH),
    source_url: nullableTrimmedText(TOURISM_OCCURRENCE_SOURCE_URL_MAX_LENGTH),
    verified_at: z.string().datetime({ offset: true }).nullable().optional(),
});

function refineOccurrenceRange<T extends { starts_at: string; ends_at: string }>(
    data: T,
    ctx: z.RefinementCtx
) {
    if (new Date(data.ends_at).getTime() <= new Date(data.starts_at).getTime()) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "ends_at must be after starts_at",
            path: ["ends_at"],
        });
    }
}

export const createTourismOccurrenceBodySchema = occurrenceBodyBase
    .strict()
    .superRefine(refineOccurrenceRange);

export type CreateTourismOccurrenceBody = z.infer<typeof createTourismOccurrenceBodySchema>;

export const updateTourismOccurrenceBodySchema = occurrenceBodyBase
    .partial()
    .strict()
    .superRefine((data, ctx) => {
        if (data.starts_at !== undefined && data.ends_at !== undefined) {
            refineOccurrenceRange(
                { starts_at: data.starts_at, ends_at: data.ends_at },
                ctx
            );
        }
    });

export type UpdateTourismOccurrenceBody = z.infer<typeof updateTourismOccurrenceBodySchema>;

export const listTourismOccurrencesQuerySchema = z.object({
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(TOURISM_CATALOG_MAX_PAGE_SIZE)
        .default(TOURISM_CATALOG_MAX_PAGE_SIZE),
    offset: z.coerce.number().int().min(0).default(0),
});

export type ListTourismOccurrencesQuery = z.infer<typeof listTourismOccurrencesQuerySchema>;

/** Public Discover list queries */
export const listPublicTourismActivitiesQuerySchema = z.object({
    admin_area_id: bigintIdStringSchema.optional(),
    activity_type: activityTypeCodeSchema.optional(),
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(TOURISM_CATALOG_MAX_PAGE_SIZE)
        .default(TOURISM_CATALOG_PAGE_SIZE),
    offset: z.coerce.number().int().min(0).default(0),
});

export type ListPublicTourismActivitiesQuery = z.infer<
    typeof listPublicTourismActivitiesQuerySchema
>;

export const listPublicTourismEventsQuerySchema = z.object({
    /** happening_now | upcoming */
    status: z.enum(["happening_now", "upcoming"]),
    admin_area_id: bigintIdStringSchema.optional(),
    event_type: eventTypeCodeSchema.optional(),
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(TOURISM_CATALOG_MAX_PAGE_SIZE)
        .default(TOURISM_CATALOG_PAGE_SIZE),
    offset: z.coerce.number().int().min(0).default(0),
});

export type ListPublicTourismEventsQuery = z.infer<typeof listPublicTourismEventsQuerySchema>;
