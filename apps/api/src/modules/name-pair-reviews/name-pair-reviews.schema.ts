import { z } from "zod";

export const NAME_PAIR_ENTITY_TYPES = [
    "place",
    "settlement",
    "admin_area",
    "street",
    "building",
    "transport_stop",
    "transport_terminal",
] as const;

export const NAME_PAIR_STATUSES = ["pending", "approved", "rejected", "skipped"] as const;

export const NAME_PAIR_DIRECTIONS = [
    "mm_to_en",
    "en_to_mm",
    "split_mixed",
    "fix_false_pair",
    "review_auto_applied",
] as const;

export const NAME_PAIR_BUCKETS = [
    "review",
    "remain_non_street",
    "remain_minor_streets",
] as const;

/** Dashboard filter for AI/auto fills re-queued for human check. */
export const NAME_PAIR_REASON_AUTO_APPLIED = "auto_applied_needs_review";

export const listNamePairReviewsQuerySchema = z.object({
    status: z.enum(NAME_PAIR_STATUSES).optional().default("pending"),
    entity_type: z.enum(NAME_PAIR_ENTITY_TYPES).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
    exclude_reason: z.string().trim().min(1).max(500).optional(),
    q: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

export const listNamePairGapsQuerySchema = z.object({
    bucket: z.enum(["remain_non_street", "remain_minor_streets"]),
    entity_type: z.enum(NAME_PAIR_ENTITY_TYPES).optional(),
    q: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

export const namePairPublicIdParamSchema = z.object({
    publicId: z.string().uuid(),
});

export const approveNamePairReviewBodySchema = z.object({
    proposed_mm: z.string().trim().min(1).max(500).nullable().optional(),
    proposed_en: z.string().trim().min(1).max(500).nullable().optional(),
    review_note: z.string().trim().min(1).max(1000).nullable().optional(),
});

export const rejectOrSkipNamePairReviewBodySchema = z.object({
    review_note: z.string().trim().min(1).max(1000).nullable().optional(),
});

export type ListNamePairReviewsQuery = z.infer<typeof listNamePairReviewsQuerySchema>;
export type ListNamePairGapsQuery = z.infer<typeof listNamePairGapsQuerySchema>;
export type ApproveNamePairReviewBody = z.infer<typeof approveNamePairReviewBodySchema>;
export type RejectOrSkipNamePairReviewBody = z.infer<typeof rejectOrSkipNamePairReviewBodySchema>;
