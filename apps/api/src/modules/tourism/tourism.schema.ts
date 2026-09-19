import { z } from "zod";

import {
    TOURISM_EDITORIAL_SCORES,
    TOURISM_MANUAL_BOOST_MAX,
    TOURISM_MANUAL_BOOST_MIN,
    TOURISM_MODERATION_NOTE_MAX_LENGTH,
    TOURISM_PRICE_LEVEL_MAX,
    TOURISM_PRICE_LEVEL_MIN,
    TOURISM_REVIEW_BODY_MAX_LENGTH,
    TOURISM_REVIEW_RATING_MAX,
    TOURISM_REVIEW_RATING_MIN,
    TOURISM_REVIEW_STATUSES,
    TOURISM_REVIEW_TITLE_MAX_LENGTH,
    TOURISM_SEASON_MODES,
    TOURISM_SHORT_DESCRIPTION_MAX_LENGTH,
    TOURISM_TYPE_CODES,
} from "./tourism.types.js";
import {
    TOURISM_NEARBY_MAX_RADIUS_M,
    TOURISM_RANKING_MODES,
} from "./tourism.ranking.js";
import { TOURISM_GEO_RANKING_SCOPES } from "./tourism.geo-ranking.js";

export const TOURISM_REVIEW_PAGE_SIZE = 20;
export const TOURISM_REVIEW_MAX_PAGE_SIZE = 50;

/** Admin can set these statuses via moderation (not soft-delete; authors use DELETE). */
export const TOURISM_MODERATION_TARGET_STATUSES = [
    "pending",
    "published",
    "rejected",
    "hidden",
] as const;

const uuidSchema = z.string().trim().uuid();

const optionalTrimmedText = (max: number) =>
    z
        .string()
        .trim()
        .min(1, "Text must not be empty after trimming")
        .max(max)
        .optional();

export const tourismPlaceIdParamSchema = z.object({
    placeId: uuidSchema,
});

export const tourismReviewIdParamSchema = z.object({
    reviewId: uuidSchema,
});

export const tourismPlaceLangQuerySchema = z.object({
    lang: z.enum(["my", "en"]).optional(),
});

const tourismTypeSchema = z.enum(TOURISM_TYPE_CODES);

const tourismEditorialScoreSchema = z.coerce
    .number()
    .int()
    .min(0)
    .max(100)
    .refine(
        (value) => (TOURISM_EDITORIAL_SCORES as readonly number[]).includes(value),
        `Preferred editorial scores are ${TOURISM_EDITORIAL_SCORES.join(", ")}`
    );

const tourismManualBoostSchema = z.coerce
    .number()
    .int()
    .min(TOURISM_MANUAL_BOOST_MIN)
    .max(TOURISM_MANUAL_BOOST_MAX);

/** Required when setting a non-zero manual boost (exceptional ranking override). */
const tourismManualBoostReasonSchema = z
    .string()
    .trim()
    .min(3, "manual_boost_reason must be at least 3 characters")
    .max(500);

const tourismMonthSchema = z.coerce.number().int().min(1).max(12);

function requireManualBoostReasonWhenNonZero(value: {
    manual_boost?: number;
    manual_boost_reason?: string | null;
}): boolean {
    if (value.manual_boost === undefined || value.manual_boost === 0) {
        return true;
    }
    return (
        typeof value.manual_boost_reason === "string" &&
        value.manual_boost_reason.trim().length >= 3
    );
}

const tourismPriceLevelSchema = z.coerce
    .number()
    .int()
    .min(TOURISM_PRICE_LEVEL_MIN)
    .max(TOURISM_PRICE_LEVEL_MAX);

export const createTourismPlaceProfileBodySchema = z
    .object({
        tourism_type: tourismTypeSchema,
        short_description: z
            .union([
                z.string().trim().min(1).max(TOURISM_SHORT_DESCRIPTION_MAX_LENGTH),
                z.null(),
            ])
            .optional(),
        price_level: z.union([tourismPriceLevelSchema, z.null()]).optional(),
        editor_pick: z.boolean().optional(),
        is_public: z.boolean().optional(),
        editorial_score: tourismEditorialScoreSchema.optional().default(50),
        manual_boost: tourismManualBoostSchema.optional().default(0),
        manual_boost_reason: z
            .union([tourismManualBoostReasonSchema, z.null()])
            .optional(),
        season_mode: z.enum(TOURISM_SEASON_MODES).optional().default("all_year"),
        season_start_month: z.union([tourismMonthSchema, z.null()]).optional().default(null),
        season_end_month: z.union([tourismMonthSchema, z.null()]).optional().default(null),
    })
    .strict()
    .refine(requireManualBoostReasonWhenNonZero, {
        message: "manual_boost_reason is required when manual_boost is non-zero",
        path: ["manual_boost_reason"],
    });

export const updateTourismPlaceProfileBodySchema = z
    .object({
        tourism_type: tourismTypeSchema.optional(),
        short_description: z
            .union([
                z.string().trim().min(1).max(TOURISM_SHORT_DESCRIPTION_MAX_LENGTH),
                z.null(),
            ])
            .optional(),
        price_level: z.union([tourismPriceLevelSchema, z.null()]).optional(),
        editor_pick: z.boolean().optional(),
        is_public: z.boolean().optional(),
        editorial_score: tourismEditorialScoreSchema.optional(),
        manual_boost: tourismManualBoostSchema.optional(),
        manual_boost_reason: z
            .union([tourismManualBoostReasonSchema, z.null()])
            .optional(),
        season_mode: z.enum(TOURISM_SEASON_MODES).optional(),
        season_start_month: z.union([tourismMonthSchema, z.null()]).optional(),
        season_end_month: z.union([tourismMonthSchema, z.null()]).optional(),
    })
    .strict()
    .refine(
        (value) =>
            value.tourism_type !== undefined ||
            value.short_description !== undefined ||
            value.price_level !== undefined ||
            value.editor_pick !== undefined ||
            value.is_public !== undefined ||
            value.editorial_score !== undefined ||
            value.manual_boost !== undefined ||
            value.manual_boost_reason !== undefined ||
            value.season_mode !== undefined ||
            value.season_start_month !== undefined ||
            value.season_end_month !== undefined,
        { message: "At least one field is required" }
    )
    .refine(requireManualBoostReasonWhenNonZero, {
        message: "manual_boost_reason is required when manual_boost is non-zero",
        path: ["manual_boost_reason"],
    });

export const createTourismReviewBodySchema = z
    .object({
        rating: z.coerce
            .number()
            .int()
            .min(TOURISM_REVIEW_RATING_MIN)
            .max(TOURISM_REVIEW_RATING_MAX),
        title: optionalTrimmedText(TOURISM_REVIEW_TITLE_MAX_LENGTH),
        body: optionalTrimmedText(TOURISM_REVIEW_BODY_MAX_LENGTH),
    })
    .strict();

export const updateTourismReviewBodySchema = z
    .object({
        rating: z.coerce
            .number()
            .int()
            .min(TOURISM_REVIEW_RATING_MIN)
            .max(TOURISM_REVIEW_RATING_MAX)
            .optional(),
        title: z
            .union([
                z.string().trim().min(1).max(TOURISM_REVIEW_TITLE_MAX_LENGTH),
                z.null(),
            ])
            .optional(),
        body: z
            .union([
                z.string().trim().min(1).max(TOURISM_REVIEW_BODY_MAX_LENGTH),
                z.null(),
            ])
            .optional(),
    })
    .strict()
    .refine(
        (value) =>
            value.rating !== undefined || value.title !== undefined || value.body !== undefined,
        { message: "At least one field is required" }
    );

export const moderateTourismReviewBodySchema = z
    .object({
        status: z.enum(TOURISM_MODERATION_TARGET_STATUSES),
        note: z
            .union([
                z.string().trim().min(1).max(TOURISM_MODERATION_NOTE_MAX_LENGTH),
                z.null(),
            ])
            .optional(),
    })
    .strict();

export const listPublishedTourismReviewsQuerySchema = z.object({
    cursor: z.string().trim().min(1).max(2_000).optional(),
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(TOURISM_REVIEW_MAX_PAGE_SIZE)
        .default(TOURISM_REVIEW_PAGE_SIZE),
});

const optionalIsoDate = z
    .string()
    .trim()
    .datetime({ offset: true })
    .optional()
    .or(z.string().trim().datetime().optional());

export const adminTourismReviewsQuerySchema = z
    .object({
        cursor: z.string().trim().min(1).max(2_000).optional(),
        limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(TOURISM_REVIEW_MAX_PAGE_SIZE)
            .default(TOURISM_REVIEW_PAGE_SIZE),
        status: z.enum(TOURISM_REVIEW_STATUSES).optional(),
        placeId: uuidSchema.optional(),
        authorId: uuidSchema.optional(),
        createdFrom: z.string().trim().min(1).max(64).optional(),
        createdTo: z.string().trim().min(1).max(64).optional(),
    })
    .superRefine((value, ctx) => {
        for (const key of ["createdFrom", "createdTo"] as const) {
            const raw = value[key];
            if (!raw) continue;
            const date = new Date(raw);
            if (Number.isNaN(date.getTime())) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [key],
                    message: `${key} must be a valid ISO date`,
                });
            }
        }
        if (value.createdFrom && value.createdTo) {
            const from = new Date(value.createdFrom);
            const to = new Date(value.createdTo);
            if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from > to) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["createdTo"],
                    message: "createdTo must be >= createdFrom",
                });
            }
        }
    });

export const adminTourismModerationNoteBodySchema = z
    .object({
        note: z
            .union([
                z.string().trim().min(1).max(TOURISM_MODERATION_NOTE_MAX_LENGTH),
                z.null(),
            ])
            .optional(),
    })
    .strict();

export type CreateTourismReviewBody = z.infer<typeof createTourismReviewBodySchema>;
export type UpdateTourismReviewBody = z.infer<typeof updateTourismReviewBodySchema>;
export type ModerateTourismReviewBody = z.infer<typeof moderateTourismReviewBodySchema>;
export type ListPublishedTourismReviewsQuery = z.infer<
    typeof listPublishedTourismReviewsQuerySchema
>;
export type AdminTourismReviewsQuery = z.infer<typeof adminTourismReviewsQuerySchema>;
export type AdminTourismModerationNoteBody = z.infer<typeof adminTourismModerationNoteBodySchema>;
export type TourismPlaceLangQuery = z.infer<typeof tourismPlaceLangQuerySchema>;
export type CreateTourismPlaceProfileBody = z.infer<typeof createTourismPlaceProfileBodySchema>;
export type UpdateTourismPlaceProfileBody = z.infer<typeof updateTourismPlaceProfileBodySchema>;

const tourismBboxSchema = z
    .string()
    .trim()
    .transform((value, ctx) => {
        const parts = value.split(",").map((part) => Number(part.trim()));
        if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'bbox must be "minLng,minLat,maxLng,maxLat"',
            });
            return z.NEVER;
        }
        const [minLng, minLat, maxLng, maxLat] = parts;
        const valid =
            minLng >= -180 &&
            maxLng <= 180 &&
            minLat >= -90 &&
            maxLat <= 90 &&
            minLng < maxLng &&
            minLat < maxLat;
        if (!valid) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "bbox coordinates are out of range or not ordered",
            });
            return z.NEVER;
        }
        return [minLng, minLat, maxLng, maxLat] as [number, number, number, number];
    });

export const listTourismPlacesRankingQuerySchema = z
    .object({
        mode: z.enum(TOURISM_RANKING_MODES).default("recommended"),
        cursor: z.string().trim().min(1).max(2_000).optional(),
        limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(TOURISM_REVIEW_MAX_PAGE_SIZE)
            .default(TOURISM_REVIEW_PAGE_SIZE),
        lang: z.enum(["my", "en"]).optional(),
        tourism_type: tourismTypeSchema.optional(),
        lat: z.coerce.number().min(-90).max(90).optional(),
        lng: z.coerce.number().min(-180).max(180).optional(),
        radius_m: z.coerce
            .number()
            .min(1)
            .max(TOURISM_NEARBY_MAX_RADIUS_M)
            .optional(),
        bbox: tourismBboxSchema.optional(),
    })
    .superRefine((value, ctx) => {
        if ((value.lat === undefined) !== (value.lng === undefined)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["lat"],
                message: "lat and lng must be provided together",
            });
        }
        if (value.mode === "nearby" && (value.lat === undefined || value.lng === undefined)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["lat"],
                message: "nearby mode requires lat and lng",
            });
        }
        if (value.radius_m !== undefined && value.mode !== "nearby") {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["radius_m"],
                message: "radius_m is only valid with mode=nearby",
            });
        }
    });

export type ListTourismPlacesRankingQuery = z.infer<typeof listTourismPlacesRankingQuerySchema>;

export type TourismRankingCursor = {
    mode: (typeof TOURISM_RANKING_MODES)[number];
    bayesianScore: number | null;
    publishedReviewCount: number;
    isVerified: boolean;
    distanceMeters: number | null;
    publicId: string;
};

export class InvalidTourismRankingCursorError extends Error {
    constructor(message = "Invalid ranking cursor") {
        super(message);
        this.name = "InvalidTourismRankingCursorError";
    }
}

export function encodeTourismRankingCursor(cursor: TourismRankingCursor): string {
    return Buffer.from(
        JSON.stringify({
            mode: cursor.mode,
            bayesian_score: cursor.bayesianScore,
            published_review_count: cursor.publishedReviewCount,
            is_verified: cursor.isVerified,
            distance_m: cursor.distanceMeters,
            public_id: cursor.publicId,
        }),
        "utf8"
    ).toString("base64url");
}

export function decodeTourismRankingCursor(raw: string): TourismRankingCursor {
    try {
        const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
            mode?: unknown;
            bayesian_score?: unknown;
            published_review_count?: unknown;
            is_verified?: unknown;
            distance_m?: unknown;
            public_id?: unknown;
        };
        if (
            typeof parsed.mode !== "string" ||
            !(TOURISM_RANKING_MODES as readonly string[]).includes(parsed.mode) ||
            typeof parsed.published_review_count !== "number" ||
            typeof parsed.is_verified !== "boolean" ||
            typeof parsed.public_id !== "string"
        ) {
            throw new InvalidTourismRankingCursorError();
        }
        uuidSchema.parse(parsed.public_id);
        const bayesianScore =
            parsed.bayesian_score === null || parsed.bayesian_score === undefined
                ? null
                : typeof parsed.bayesian_score === "number" && Number.isFinite(parsed.bayesian_score)
                  ? parsed.bayesian_score
                  : null;
        if (parsed.bayesian_score !== null && parsed.bayesian_score !== undefined && bayesianScore === null) {
            throw new InvalidTourismRankingCursorError();
        }
        const distanceMeters =
            parsed.distance_m === null || parsed.distance_m === undefined
                ? null
                : typeof parsed.distance_m === "number" && Number.isFinite(parsed.distance_m)
                  ? parsed.distance_m
                  : null;
        if (parsed.distance_m !== null && parsed.distance_m !== undefined && distanceMeters === null) {
            throw new InvalidTourismRankingCursorError();
        }
        return {
            mode: parsed.mode as TourismRankingCursor["mode"],
            bayesianScore,
            publishedReviewCount: parsed.published_review_count,
            isVerified: parsed.is_verified,
            distanceMeters,
            publicId: parsed.public_id,
        };
    } catch (error) {
        if (error instanceof InvalidTourismRankingCursorError) throw error;
        throw new InvalidTourismRankingCursorError();
    }
}

void optionalIsoDate;
export type TourismReviewCursor = {
    createdAt: Date;
    publicId: string;
};

export class InvalidTourismReviewCursorError extends Error {
    constructor(message = "Invalid cursor") {
        super(message);
        this.name = "InvalidTourismReviewCursorError";
    }
}

export function encodeTourismReviewCursor(cursor: TourismReviewCursor): string {
    return Buffer.from(
        JSON.stringify({
            created_at: cursor.createdAt.toISOString(),
            public_id: cursor.publicId,
        }),
        "utf8"
    ).toString("base64url");
}

export function decodeTourismReviewCursor(raw: string): TourismReviewCursor {
    try {
        const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
            created_at?: unknown;
            public_id?: unknown;
        };
        if (typeof parsed.created_at !== "string" || typeof parsed.public_id !== "string") {
            throw new InvalidTourismReviewCursorError();
        }
        const createdAt = new Date(parsed.created_at);
        if (Number.isNaN(createdAt.getTime())) {
            throw new InvalidTourismReviewCursorError();
        }
        uuidSchema.parse(parsed.public_id);
        return { createdAt, publicId: parsed.public_id };
    } catch (error) {
        if (error instanceof InvalidTourismReviewCursorError) throw error;
        throw new InvalidTourismReviewCursorError();
    }
}

/** Re-export status list for OpenAPI. */
export const TOURISM_REVIEW_STATUS_VALUES = TOURISM_REVIEW_STATUSES;

export const listTourismGeoRankingQuerySchema = z
    .object({
        scope: z.enum(TOURISM_GEO_RANKING_SCOPES),
        admin_area_id: z
            .string()
            .trim()
            .regex(/^\d+$/, "admin_area_id must be a numeric id")
            .optional(),
        tourism_type: tourismTypeSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).max(100_000).default(0),
        lang: z.enum(["my", "en"]).optional(),
        reference_month: z.coerce.number().int().min(1).max(12).optional(),
    })
    .superRefine((value, ctx) => {
        if (
            (value.scope === "township" || value.scope === "region") &&
            value.admin_area_id === undefined
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["admin_area_id"],
                message: `admin_area_id is required for ${value.scope} ranking`,
            });
        }
        if (value.scope === "national" && value.admin_area_id !== undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["admin_area_id"],
                message: "admin_area_id must not be set for national ranking",
            });
        }
    });

export type ListTourismGeoRankingQuery = z.infer<typeof listTourismGeoRankingQuerySchema>;

export const listAdminTourismGeoRankingQuerySchema = listTourismGeoRankingQuerySchema;

const tourismGeoRankingPreviewProposedSchema = z
    .object({
        editorial_score: tourismEditorialScoreSchema.optional(),
        season_mode: z.enum(TOURISM_SEASON_MODES).optional(),
        season_start_month: z.union([tourismMonthSchema, z.null()]).optional(),
        season_end_month: z.union([tourismMonthSchema, z.null()]).optional(),
        manual_boost: tourismManualBoostSchema.optional(),
    })
    .strict();

export const postAdminTourismRankingPreviewBodySchema = z
    .object({
        place_public_id: uuidSchema,
        scope: z.enum(TOURISM_GEO_RANKING_SCOPES),
        admin_area_id: z
            .string()
            .trim()
            .regex(/^\d+$/, "admin_area_id must be a numeric id")
            .optional(),
        reference_month: z.coerce.number().int().min(1).max(12).optional(),
        proposed: tourismGeoRankingPreviewProposedSchema.optional().default({}),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (
            (value.scope === "township" || value.scope === "region") &&
            value.admin_area_id === undefined
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["admin_area_id"],
                message: `admin_area_id is required for ${value.scope} ranking`,
            });
        }
        if (value.scope === "national" && value.admin_area_id !== undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["admin_area_id"],
                message: "admin_area_id must not be set for national ranking",
            });
        }
    });

export type PostAdminTourismRankingPreviewBody = z.infer<
    typeof postAdminTourismRankingPreviewBodySchema
>;

export const listAdminTourismCandidatesQuerySchema = z.object({
    region_admin_area_id: z
        .string()
        .trim()
        .regex(/^\d+$/, "region_admin_area_id must be a numeric id")
        .optional(),
    township_admin_area_id: z
        .string()
        .trim()
        .regex(/^\d+$/, "township_admin_area_id must be a numeric id")
        .optional(),
    category_code: z.string().trim().min(1).max(64).optional(),
    q: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    lang: z.enum(["my", "en"]).optional(),
});

export type ListAdminTourismCandidatesQuery = z.infer<
    typeof listAdminTourismCandidatesQuerySchema
>;

/** Township-scoped CoreMap place search for Tourism admin pickers. */
export const listAdminTourismPlaceSearchQuerySchema = z.object({
    admin_area_id: z
        .string()
        .trim()
        .regex(/^\d+$/, "admin_area_id must be a numeric id"),
    q: z.string().trim().min(2).max(200),
    limit: z.coerce.number().int().min(1).max(20).default(15),
});

export type ListAdminTourismPlaceSearchQuery = z.infer<
    typeof listAdminTourismPlaceSearchQuerySchema
>;

export const approveTourismCandidateBodySchema = createTourismPlaceProfileBodySchema;

export type ApproveTourismCandidateBody = CreateTourismPlaceProfileBody;

export const ignoreTourismCandidateBodySchema = z
    .object({
        reason: z.string().trim().min(1).max(500).optional(),
    })
    .strict();

export type IgnoreTourismCandidateBody = z.infer<typeof ignoreTourismCandidateBodySchema>;

export const listAdminTourismCandidatesOverviewQuerySchema = z.object({
    region_admin_area_id: z
        .string()
        .trim()
        .regex(/^\d+$/, "region_admin_area_id must be a numeric id")
        .optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export type ListAdminTourismCandidatesOverviewQuery = z.infer<
    typeof listAdminTourismCandidatesOverviewQuerySchema
>;
