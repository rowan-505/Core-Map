/**
 * Zod schemas for admin tourism.research_candidates (staging only — not public).
 */
import { z } from "zod";

import {
    TOURISM_RESEARCH_ENTITY_TYPES,
    TOURISM_RESEARCH_STATUSES,
} from "./tourism.types.js";

export const TOURISM_RESEARCH_PAGE_SIZE = 20;
export const TOURISM_RESEARCH_MAX_PAGE_SIZE = 50;
export const TOURISM_RESEARCH_BULK_MAX = 100;

const uuidSchema = z.string().trim().uuid();
const bigintIdStringSchema = z
    .string()
    .trim()
    .regex(/^\d+$/, "Must be a numeric id");

const entityTypeSchema = z.enum(TOURISM_RESEARCH_ENTITY_TYPES);
const researchStatusSchema = z.enum(TOURISM_RESEARCH_STATUSES);

const pageLimitSchema = z.coerce
    .number()
    .int()
    .min(1)
    .max(TOURISM_RESEARCH_MAX_PAGE_SIZE)
    .default(TOURISM_RESEARCH_PAGE_SIZE);

const pageOffsetSchema = z.coerce.number().int().min(0).default(0);

const confidenceSchema = z.coerce.number().int().min(0).max(100);

const optionalUrlSchema = z.string().trim().url().max(2000).optional();
const optionalIsoDateSchema = z.string().datetime({ offset: true }).optional();

/** Flexible but structured normalized payload — not free-form garbage. */
export const researchNormalizedPayloadSchema = z
    .object({
        candidate_key: z.string().trim().min(1).max(200).optional(),
        aliases: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
        description: z.string().trim().max(10000).nullable().optional(),
        short_description: z.string().trim().max(1000).nullable().optional(),
        name_en: z.string().trim().max(200).nullable().optional(),
        name_mm: z.string().trim().max(200).nullable().optional(),
        name_as_found: z.string().trim().max(200).nullable().optional(),
        food_type: z.string().trim().max(64).nullable().optional(),
        labels: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
        guide_type: z.string().trim().max(64).nullable().optional(),
        advisory_type: z.string().trim().max(64).nullable().optional(),
        severity: z.string().trim().max(32).nullable().optional(),
        title: z.string().trim().max(200).nullable().optional(),
        content: z.string().trim().max(20000).nullable().optional(),
        activity_type: z.string().trim().max(64).nullable().optional(),
        activity_type_guess: z.string().trim().max(64).nullable().optional(),
        event_type: z.string().trim().max(64).nullable().optional(),
        event_type_guess: z.string().trim().max(64).nullable().optional(),
        tourism_type_guess: z.string().trim().max(64).nullable().optional(),
        source_url: optionalUrlSchema.nullable().optional(),
        latest_evidence_date: optionalIsoDateSchema.nullable().optional(),
        possible_duplicate: z.boolean().optional(),
        primary_place_suggestion: z.string().trim().max(300).nullable().optional(),
        season_evidence: z.string().trim().max(2000).nullable().optional(),
        occurrence_starts_at: optionalIsoDateSchema.nullable().optional(),
        occurrence_ends_at: optionalIsoDateSchema.nullable().optional(),
        recurring_context: z.string().trim().max(2000).nullable().optional(),
        schedule_uncertainty: z.string().trim().max(2000).nullable().optional(),
        available_at: z
            .array(
                z
                    .object({
                        place_name: z.string().trim().max(200).optional(),
                        place_public_id: z.string().trim().uuid().optional(),
                        location_text: z.string().trim().max(500).nullable().optional(),
                        place_type_guess: z.string().trim().max(64).nullable().optional(),
                        availability_note: z.string().trim().max(1000).nullable().optional(),
                        source_url: optionalUrlSchema.nullable().optional(),
                        confidence: confidenceSchema.nullable().optional(),
                        is_signature_here: z.boolean().optional(),
                    })
                    .strict()
            )
            .max(50)
            .optional(),
        effective_from: z.string().datetime({ offset: true }).nullable().optional(),
        effective_until: z.string().datetime({ offset: true }).nullable().optional(),
        editorial_recommendation: z.coerce.number().int().min(0).max(100).nullable().optional(),
        importance_reference: z.coerce.number().int().min(0).max(100).nullable().optional(),
        traditionality_reference: z.coerce.number().int().min(0).max(100).nullable().optional(),
        food_significance_reference: z.coerce.number().int().min(0).max(100).nullable().optional(),
        trend_evidence_score: z.coerce.number().int().min(0).max(100).nullable().optional(),
        freshness_score: z.coerce.number().int().min(0).max(100).nullable().optional(),
        manual_boost_reference: z.coerce.number().int().min(0).max(100).nullable().optional(),
        reference_scores: z
            .object({
                importance: z.coerce.number().min(0).max(100).optional(),
                popularity: z.coerce.number().min(0).max(100).optional(),
                review: z.coerce.number().min(0).max(100).optional(),
                editorial: z.coerce.number().min(0).max(100).optional(),
                traditionality: z.coerce.number().min(0).max(100).optional(),
                food_significance: z.coerce.number().min(0).max(100).optional(),
                trend: z.coerce.number().min(0).max(100).optional(),
                freshness: z.coerce.number().min(0).max(100).optional(),
            })
            .strict()
            .optional(),
        sources: z
            .array(
                z
                    .object({
                        url: optionalUrlSchema.nullable().optional(),
                        title: z.string().trim().max(300).nullable().optional(),
                        publisher: z.string().trim().max(200).nullable().optional(),
                        accessed_at: optionalIsoDateSchema.nullable().optional(),
                        published_at: optionalIsoDateSchema.nullable().optional(),
                        note: z.string().trim().max(1000).nullable().optional(),
                    })
                    .strict()
            )
            .max(50)
            .optional(),
        uncertainties: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
        conflicts: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
        guide_details: z.record(z.string(), z.unknown()).optional(),
        advisory_details: z.record(z.string(), z.unknown()).optional(),
        event_details: z.record(z.string(), z.unknown()).optional(),
        food_details: z.record(z.string(), z.unknown()).optional(),
        notes: z.string().trim().max(5000).nullable().optional(),
    })
    .strict();

export type ResearchNormalizedPayload = z.infer<typeof researchNormalizedPayloadSchema>;

export const tourismResearchIdParamSchema = z.object({
    id: uuidSchema,
});

export const listAdminTourismResearchQuerySchema = z.object({
    admin_area_id: bigintIdStringSchema.optional(),
    entity_type: entityTypeSchema.optional(),
    research_status: researchStatusSchema.optional(),
    evidence_confidence_min: confidenceSchema.optional(),
    evidence_confidence_max: confidenceSchema.optional(),
    q: z.string().trim().min(1).max(200).optional(),
    limit: pageLimitSchema,
    offset: pageOffsetSchema,
});

export type ListAdminTourismResearchQuery = z.infer<
    typeof listAdminTourismResearchQuerySchema
>;

const researchCandidateImportItemSchema = z
    .object({
        admin_area_id: bigintIdStringSchema.optional(),
        admin_area_public_id: uuidSchema.optional(),
        candidate_key: z.string().trim().min(1).max(200),
        entity_type: entityTypeSchema,
        name: z.string().trim().min(1).max(200),
        evidence_confidence: confidenceSchema.nullable().optional(),
        normalized_payload: researchNormalizedPayloadSchema,
        research_provider: z.string().trim().min(1).max(100),
        research_run_id: z.string().trim().min(1).max(200),
        researched_at: z.string().datetime({ offset: true }),
        research_status: researchStatusSchema.optional().default("new"),
    })
    .strict()
    .superRefine((data, ctx) => {
        const hasInternal = Boolean(data.admin_area_id);
        const hasPublic = Boolean(data.admin_area_public_id);
        if (hasInternal === hasPublic) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Provide exactly one of admin_area_id or admin_area_public_id",
                path: ["admin_area_public_id"],
            });
        }
        const sources = data.normalized_payload.sources ?? [];
        const usable = sources.some(
            (s) =>
                (typeof s.url === "string" && s.url.length > 0) ||
                (typeof s.title === "string" && s.title.length > 0)
        );
        if (!usable) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "normalized_payload.sources must include at least one usable source",
                path: ["normalized_payload", "sources"],
            });
        }
    });

export const bulkImportTourismResearchBodySchema = z
    .object({
        candidates: z
            .array(researchCandidateImportItemSchema)
            .min(1)
            .max(TOURISM_RESEARCH_BULK_MAX),
    })
    .strict();

export type BulkImportTourismResearchBody = z.infer<
    typeof bulkImportTourismResearchBodySchema
>;

export const updateTourismResearchStatusBodySchema = z
    .object({
        research_status: researchStatusSchema,
        created_entity_type: entityTypeSchema.nullable().optional(),
        created_entity_public_id: uuidSchema.nullable().optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
        if (data.research_status === "added") {
            if (!data.created_entity_type || !data.created_entity_public_id) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message:
                        "created_entity_type and created_entity_public_id are required when marking added",
                    path: ["created_entity_type"],
                });
            }
        }
        const hasType = data.created_entity_type != null;
        const hasId = data.created_entity_public_id != null;
        if (hasType !== hasId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "created_entity_type and created_entity_public_id must be set together",
                path: ["created_entity_public_id"],
            });
        }
    });

export type UpdateTourismResearchStatusBody = z.infer<
    typeof updateTourismResearchStatusBodySchema
>;

export const markTourismResearchAddedBodySchema = z
    .object({
        created_entity_type: entityTypeSchema,
        created_entity_public_id: uuidSchema,
    })
    .strict();

export type MarkTourismResearchAddedBody = z.infer<
    typeof markTourismResearchAddedBodySchema
>;
