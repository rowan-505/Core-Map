/**
 * Zod schema for normalized township research files (Phase 5).
 */
import { z } from "zod";

export const NORMALIZED_SCHEMA_VERSION = "tourism-research-v1";
export const NORMALIZE_PROMPT_VERSION = "2026-09-21.1";
export const DEFAULT_NORMALIZE_MODEL = "gemini-3.1-flash-lite";

export const RESEARCH_ENTITY_TYPES = [
  "attraction",
  "activity",
  "event",
  "food",
  "food_place",
  "local_guide",
  "advisory",
  "other",
] as const;

const confidence = z.number().int().min(0).max(100);
const optionalUrl = z.string().url().max(2000).nullable().optional();
const optionalIso = z.string().datetime({ offset: true }).nullable().optional();

export const sourceSchema = z
  .object({
    url: optionalUrl,
    title: z.string().max(300).nullable().optional(),
    publisher: z.string().max(200).nullable().optional(),
    accessed_at: optionalIso,
    published_at: optionalIso,
    note: z.string().max(1000).nullable().optional(),
  })
  .strict();

export const availableAtSchema = z
  .object({
    place_name: z.string().min(1).max(200).optional(),
    location_text: z.string().max(500).nullable().optional(),
    place_type_guess: z.string().max(64).nullable().optional(),
    source_url: optionalUrl,
    confidence: confidence.nullable().optional(),
    availability_note: z.string().max(1000).nullable().optional(),
  })
  .strict();

export const candidatePayloadSchema = z
  .object({
    name_as_found: z.string().max(200).nullable().optional(),
    name_en: z.string().max(200).nullable().optional(),
    name_mm: z.string().max(200).nullable().optional(),
    aliases: z.array(z.string().min(1).max(200)).max(50).optional(),
    description: z.string().max(10000).nullable().optional(),
    short_description: z.string().max(1000).nullable().optional(),
    sources: z.array(sourceSchema).max(50).optional(),
    uncertainties: z.array(z.string().min(1).max(1000)).max(50).optional(),
    conflicts: z.array(z.string().min(1).max(1000)).max(50).optional(),
    latest_evidence_date: optionalIso,
    possible_duplicate: z.boolean().optional(),
    reference_scores: z
      .object({
        importance: z.number().min(0).max(100).optional(),
        editorial: z.number().min(0).max(100).optional(),
        traditionality: z.number().min(0).max(100).optional(),
        food_significance: z.number().min(0).max(100).optional(),
        trend: z.number().min(0).max(100).optional(),
        freshness: z.number().min(0).max(100).optional(),
      })
      .strict()
      .optional(),
    tourism_type_guess: z.string().max(64).nullable().optional(),
    editorial_recommendation: z
      .union([
        z.literal(20),
        z.literal(35),
        z.literal(50),
        z.literal(65),
        z.literal(80),
        z.literal(95),
      ])
      .nullable()
      .optional(),
    importance_reference: confidence.nullable().optional(),
    trend_evidence_score: confidence.nullable().optional(),
    freshness_score: confidence.nullable().optional(),
    manual_boost_reference: confidence.nullable().optional(),
    season_evidence: z.string().max(2000).nullable().optional(),
    activity_type_guess: z.string().max(64).nullable().optional(),
    primary_place_suggestion: z.string().max(300).nullable().optional(),
    event_type_guess: z.string().max(64).nullable().optional(),
    occurrence_starts_at: optionalIso,
    occurrence_ends_at: optionalIso,
    recurring_context: z.string().max(2000).nullable().optional(),
    schedule_uncertainty: z.string().max(2000).nullable().optional(),
    food_type: z.string().max(64).nullable().optional(),
    labels: z
      .array(
        z.enum([
          "signature",
          "must_try",
          "popular",
          "traditional",
          "local_specialty",
          "street_food",
          "seasonal",
        ]),
      )
      .max(20)
      .optional(),
    traditionality_reference: confidence.nullable().optional(),
    food_significance_reference: confidence.nullable().optional(),
    available_at: z.array(availableAtSchema).max(50).optional(),
    place_type_guess: z.string().max(64).nullable().optional(),
    location_text: z.string().max(500).nullable().optional(),
    guide_type: z.string().max(64).nullable().optional(),
    title: z.string().max(200).nullable().optional(),
    content: z.string().max(20000).nullable().optional(),
    advisory_type: z.string().max(64).nullable().optional(),
    severity: z.enum(["info", "caution", "important"]).nullable().optional(),
    effective_from: optionalIso,
    effective_until: optionalIso,
    notes: z.string().max(5000).nullable().optional(),
  })
  .strict();

export const normalizedCandidateSchema = z
  .object({
    candidate_key: z.string().trim().min(1).max(200),
    entity_type: z.enum(RESEARCH_ENTITY_TYPES),
    name: z.string().trim().min(1).max(200),
    evidence_confidence: confidence,
    payload: candidatePayloadSchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    const sources = data.payload.sources ?? [];
    const usable = sources.some(
      (s) =>
        (typeof s.url === "string" && s.url.length > 0) ||
        (typeof s.title === "string" && s.title.trim().length > 0),
    );
    if (!usable) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each candidate requires at least one usable source",
        path: ["payload", "sources"],
      });
    }
    if (
      (data.entity_type === "local_guide" || data.entity_type === "advisory") &&
      !data.payload.title &&
      !data.name
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "title or name is required",
        path: ["payload", "title"],
      });
    }
  });

export const researchRunSchema = z
  .object({
    township_public_id: z.string().uuid(),
    township_name_en: z.string().min(1),
    township_name_mm: z.string().min(1),
    region_en: z.string().min(1),
    provider: z.literal("gemini"),
    research_interaction_id: z.string().min(1).max(200),
    researched_at: z.string().datetime({ offset: true }),
    prompt_version: z.string().min(1),
  })
  .strict();

export const normalizedDocumentSchema = z
  .object({
    schema_version: z.literal(NORMALIZED_SCHEMA_VERSION),
    research_run: researchRunSchema,
    candidates: z.array(normalizedCandidateSchema).max(500),
  })
  .strict();

export type NormalizedDocument = z.infer<typeof normalizedDocumentSchema>;
export type NormalizedCandidate = z.infer<typeof normalizedCandidateSchema>;

export function parseNormalizedDocument(raw: unknown): NormalizedDocument {
  return normalizedDocumentSchema.parse(raw);
}

export function safeParseNormalizedDocument(raw: unknown) {
  return normalizedDocumentSchema.safeParse(raw);
}
