/**
 * Zod schemas for tourism foods, local guides, and advisories.
 */
import { z } from "zod";

import {
    TOURISM_ADVISORY_DESCRIPTION_MAX_LENGTH,
    TOURISM_ADVISORY_SEVERITIES,
    TOURISM_ADVISORY_TITLE_MAX_LENGTH,
    TOURISM_ADVISORY_TYPES,
    TOURISM_AVAILABILITY_NOTE_MAX_LENGTH,
    TOURISM_FOOD_LABELS,
    TOURISM_FOOD_NAME_MAX_LENGTH,
    TOURISM_FOOD_TYPES,
    TOURISM_GUIDE_CONTENT_MAX_LENGTH,
    TOURISM_GUIDE_TITLE_MAX_LENGTH,
    TOURISM_GUIDE_TYPES,
    TOURISM_SHORT_DESCRIPTION_MAX_LENGTH,
    TOURISM_SOURCE_URL_MAX_LENGTH,
} from "./tourism.types.js";

export const TOURISM_VISITOR_PAGE_SIZE = 20;
export const TOURISM_VISITOR_MAX_PAGE_SIZE = 50;

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

const pageLimitSchema = z.coerce
    .number()
    .int()
    .min(1)
    .max(TOURISM_VISITOR_MAX_PAGE_SIZE)
    .default(TOURISM_VISITOR_PAGE_SIZE);

const pageOffsetSchema = z.coerce.number().int().min(0).default(0);

const foodTypeSchema = z.enum(TOURISM_FOOD_TYPES);
const foodLabelSchema = z.enum(TOURISM_FOOD_LABELS);
const guideTypeSchema = z.enum(TOURISM_GUIDE_TYPES);
const advisoryTypeSchema = z.enum(TOURISM_ADVISORY_TYPES);
const advisorySeveritySchema = z.enum(TOURISM_ADVISORY_SEVERITIES);

const foodLabelsSchema = z
    .array(foodLabelSchema)
    .max(TOURISM_FOOD_LABELS.length)
    .default([])
    .superRefine((labels, ctx) => {
        if (new Set(labels).size !== labels.length) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "labels must not contain duplicates",
            });
        }
    });

function refineEffectiveRange<
    T extends { effective_from?: string | null; effective_until?: string | null },
>(data: T, ctx: z.RefinementCtx) {
    if (
        data.effective_from != null &&
        data.effective_until != null &&
        new Date(data.effective_until).getTime() < new Date(data.effective_from).getTime()
    ) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "effective_until must be on or after effective_from",
            path: ["effective_until"],
        });
    }
}

// --- Foods ---

export const tourismFoodIdParamSchema = z.object({
    id: uuidSchema,
});

export const tourismFoodPlaceParamSchema = z.object({
    foodId: uuidSchema,
    placePublicId: uuidSchema,
});

export const tourismFoodPlacesCreateParamSchema = z.object({
    foodId: uuidSchema,
});

export const listAdminTourismFoodsQuerySchema = z.object({
    admin_area_id: bigintIdStringSchema.optional(),
    food_type: foodTypeSchema.optional(),
    label: foodLabelSchema.optional(),
    is_active: booleanQuerySchema,
    is_verified: booleanQuerySchema,
    q: z.string().trim().min(1).max(200).optional(),
    limit: pageLimitSchema,
    offset: pageOffsetSchema,
});

export type ListAdminTourismFoodsQuery = z.infer<typeof listAdminTourismFoodsQuerySchema>;

const foodBodyBase = z.object({
    name: z.string().trim().min(1).max(TOURISM_FOOD_NAME_MAX_LENGTH),
    name_en: nullableTrimmedText(TOURISM_FOOD_NAME_MAX_LENGTH),
    name_mm: nullableTrimmedText(TOURISM_FOOD_NAME_MAX_LENGTH),
    short_description: nullableTrimmedText(TOURISM_SHORT_DESCRIPTION_MAX_LENGTH),
    food_type: foodTypeSchema,
    labels: foodLabelsSchema,
    admin_area_id: bigintIdStringSchema,
    is_active: z.boolean().default(true),
    is_verified: z.boolean().default(false),
    source_url: nullableTrimmedText(TOURISM_SOURCE_URL_MAX_LENGTH),
    verified_at: z.string().datetime({ offset: true }).nullable().optional(),
});

export const createTourismFoodBodySchema = foodBodyBase.strict();
export type CreateTourismFoodBody = z.infer<typeof createTourismFoodBodySchema>;

export const updateTourismFoodBodySchema = foodBodyBase.partial().strict();
export type UpdateTourismFoodBody = z.infer<typeof updateTourismFoodBodySchema>;

const foodPlaceLinkBodyBase = z.object({
    place_public_id: uuidSchema,
    availability_note: nullableTrimmedText(TOURISM_AVAILABILITY_NOTE_MAX_LENGTH),
    is_signature_here: z.boolean().default(false),
    is_verified: z.boolean().default(false),
    source_url: nullableTrimmedText(TOURISM_SOURCE_URL_MAX_LENGTH),
    verified_at: z.string().datetime({ offset: true }).nullable().optional(),
});

export const createTourismFoodPlaceLinkBodySchema = foodPlaceLinkBodyBase.strict();
export type CreateTourismFoodPlaceLinkBody = z.infer<typeof createTourismFoodPlaceLinkBodySchema>;

export const updateTourismFoodPlaceLinkBodySchema = foodPlaceLinkBodyBase
    .omit({ place_public_id: true })
    .partial()
    .strict();
export type UpdateTourismFoodPlaceLinkBody = z.infer<typeof updateTourismFoodPlaceLinkBodySchema>;

export const listPublicTourismFoodsQuerySchema = z.object({
    admin_area_id: bigintIdStringSchema.optional(),
    food_type: foodTypeSchema.optional(),
    label: foodLabelSchema.optional(),
    limit: pageLimitSchema,
    offset: pageOffsetSchema,
});

export type ListPublicTourismFoodsQuery = z.infer<typeof listPublicTourismFoodsQuerySchema>;

// --- Local guides ---

export const tourismGuideIdParamSchema = z.object({
    id: uuidSchema,
});

export const listAdminTourismGuidesQuerySchema = z.object({
    admin_area_id: bigintIdStringSchema.optional(),
    place_public_id: uuidSchema.optional(),
    guide_type: guideTypeSchema.optional(),
    is_active: booleanQuerySchema,
    is_verified: booleanQuerySchema,
    q: z.string().trim().min(1).max(200).optional(),
    limit: pageLimitSchema,
    offset: pageOffsetSchema,
});

export type ListAdminTourismGuidesQuery = z.infer<typeof listAdminTourismGuidesQuerySchema>;

const guideBodyBase = z.object({
    admin_area_id: bigintIdStringSchema,
    place_public_id: uuidSchema.nullable().optional(),
    guide_type: guideTypeSchema,
    title: z.string().trim().min(1).max(TOURISM_GUIDE_TITLE_MAX_LENGTH),
    short_description: nullableTrimmedText(TOURISM_SHORT_DESCRIPTION_MAX_LENGTH),
    content: z.string().trim().min(1).max(TOURISM_GUIDE_CONTENT_MAX_LENGTH),
    is_active: z.boolean().default(true),
    is_verified: z.boolean().default(false),
    source_url: nullableTrimmedText(TOURISM_SOURCE_URL_MAX_LENGTH),
    verified_at: z.string().datetime({ offset: true }).nullable().optional(),
});

export const createTourismGuideBodySchema = guideBodyBase.strict();
export type CreateTourismGuideBody = z.infer<typeof createTourismGuideBodySchema>;

export const updateTourismGuideBodySchema = guideBodyBase.partial().strict();
export type UpdateTourismGuideBody = z.infer<typeof updateTourismGuideBodySchema>;

export const listPublicTourismGuidesQuerySchema = z.object({
    admin_area_id: bigintIdStringSchema.optional(),
    place_public_id: uuidSchema.optional(),
    guide_type: guideTypeSchema.optional(),
    limit: pageLimitSchema,
    offset: pageOffsetSchema,
});

export type ListPublicTourismGuidesQuery = z.infer<typeof listPublicTourismGuidesQuerySchema>;

// --- Advisories ---

export const tourismAdvisoryIdParamSchema = z.object({
    id: uuidSchema,
});

export const listAdminTourismAdvisoriesQuerySchema = z.object({
    admin_area_id: bigintIdStringSchema.optional(),
    place_public_id: uuidSchema.optional(),
    activity_public_id: uuidSchema.optional(),
    event_public_id: uuidSchema.optional(),
    advisory_type: advisoryTypeSchema.optional(),
    severity: advisorySeveritySchema.optional(),
    is_active: booleanQuerySchema,
    is_verified: booleanQuerySchema,
    q: z.string().trim().min(1).max(200).optional(),
    limit: pageLimitSchema,
    offset: pageOffsetSchema,
});

export type ListAdminTourismAdvisoriesQuery = z.infer<
    typeof listAdminTourismAdvisoriesQuerySchema
>;

const advisoryBodyBase = z.object({
    admin_area_id: bigintIdStringSchema,
    place_public_id: uuidSchema.nullable().optional(),
    activity_public_id: uuidSchema.nullable().optional(),
    event_public_id: uuidSchema.nullable().optional(),
    advisory_type: advisoryTypeSchema,
    title: z.string().trim().min(1).max(TOURISM_ADVISORY_TITLE_MAX_LENGTH),
    description: z.string().trim().min(1).max(TOURISM_ADVISORY_DESCRIPTION_MAX_LENGTH),
    severity: advisorySeveritySchema,
    effective_from: z.string().datetime({ offset: true }).nullable().optional(),
    effective_until: z.string().datetime({ offset: true }).nullable().optional(),
    is_active: z.boolean().default(true),
    is_verified: z.boolean().default(false),
    source_url: nullableTrimmedText(TOURISM_SOURCE_URL_MAX_LENGTH),
    verified_at: z.string().datetime({ offset: true }).nullable().optional(),
});

export const createTourismAdvisoryBodySchema = advisoryBodyBase
    .strict()
    .superRefine(refineEffectiveRange);
export type CreateTourismAdvisoryBody = z.infer<typeof createTourismAdvisoryBodySchema>;

export const updateTourismAdvisoryBodySchema = advisoryBodyBase
    .partial()
    .strict()
    .superRefine((data, ctx) => {
        if (data.effective_from !== undefined || data.effective_until !== undefined) {
            refineEffectiveRange(data, ctx);
        }
    });
export type UpdateTourismAdvisoryBody = z.infer<typeof updateTourismAdvisoryBodySchema>;

export const listPublicTourismAdvisoriesQuerySchema = z.object({
    admin_area_id: bigintIdStringSchema.optional(),
    place_public_id: uuidSchema.optional(),
    advisory_type: advisoryTypeSchema.optional(),
    severity: advisorySeveritySchema.optional(),
    limit: pageLimitSchema,
    offset: pageOffsetSchema,
});

export type ListPublicTourismAdvisoriesQuery = z.infer<
    typeof listPublicTourismAdvisoriesQuerySchema
>;
