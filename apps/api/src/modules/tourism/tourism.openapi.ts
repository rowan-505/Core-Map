import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    conflictSchema,
    forbiddenSchema,
    messageSchema,
    notFoundSchema,
    unauthorizedSchema,
} from "../../lib/openapi/common.js";
import {
    TOURISM_MODERATION_TARGET_STATUSES,
    TOURISM_REVIEW_MAX_PAGE_SIZE,
    TOURISM_REVIEW_PAGE_SIZE,
    TOURISM_REVIEW_STATUS_VALUES,
} from "./tourism.schema.js";
import {
    TOURISM_EDITORIAL_SCORES,
    TOURISM_SEASON_MODES,
    TOURISM_TYPE_CODES,
} from "./tourism.types.js";

const authorSchema = {
    type: "object",
    required: ["public_id", "display_name"],
    properties: {
        public_id: { type: "string", format: "uuid" },
        display_name: { type: "string" },
    },
    additionalProperties: false,
} as const;

const reviewPublicSchema = {
    type: "object",
    required: [
        "public_id",
        "place_public_id",
        "rating",
        "title",
        "body",
        "status",
        "created_at",
        "updated_at",
        "published_at",
        "author",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        place_public_id: { type: "string", format: "uuid" },
        rating: { type: "integer", minimum: 1, maximum: 5 },
        title: { type: "string", nullable: true },
        body: { type: "string", nullable: true },
        status: { type: "string", enum: [...TOURISM_REVIEW_STATUS_VALUES] },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
        published_at: { type: "string", format: "date-time", nullable: true },
        author: authorSchema,
    },
    additionalProperties: false,
} as const;

const reviewOwnerSchema = {
    type: "object",
    required: [...reviewPublicSchema.required, "moderation_note"],
    properties: {
        ...reviewPublicSchema.properties,
        moderation_note: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const ratingSummarySchema = {
    type: "object",
    required: ["place_public_id", "published_review_count", "average_rating", "updated_at"],
    properties: {
        place_public_id: { type: "string", format: "uuid" },
        published_review_count: { type: "integer", minimum: 0 },
        average_rating: { type: "number", nullable: true },
        review_score: { type: "number", minimum: 0, maximum: 100 },
        updated_at: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
} as const;

const conflictWithCodeSchema = {
    type: "object",
    required: ["message"],
    properties: {
        message: { type: "string" },
        code: { type: "string" },
    },
    additionalProperties: false,
} as const;

const forbiddenWithCodeSchema = {
    type: "object",
    required: ["message"],
    properties: {
        message: { type: "string" },
        code: { type: "string" },
    },
    additionalProperties: false,
} as const;

export const postTourismReviewSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "Create a tourism review for a place",
    description:
        "Authenticated. Starts as pending. One non-deleted review per user/place. Rating required.",
    security: bearerAuth,
    params: {
        type: "object",
        required: ["placeId"],
        properties: { placeId: { type: "string", format: "uuid" } },
    },
    body: {
        type: "object",
        required: ["rating"],
        properties: {
            rating: { type: "integer", minimum: 1, maximum: 5 },
            title: { type: "string", minLength: 1, maxLength: 200 },
            body: { type: "string", minLength: 1, maxLength: 5000 },
        },
        additionalProperties: false,
    },
    response: {
        201: reviewOwnerSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenWithCodeSchema,
        404: notFoundSchema,
        409: conflictWithCodeSchema,
    },
};

export const getPublishedTourismReviewsSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "List published tourism reviews for a place",
    description:
        "Public. Returns only published reviews. Cursor pagination with stable created_at/public_id order. No moderation fields.",
    params: {
        type: "object",
        required: ["placeId"],
        properties: { placeId: { type: "string", format: "uuid" } },
    },
    querystring: {
        type: "object",
        properties: {
            cursor: { type: "string", minLength: 1, maxLength: 2000 },
            limit: {
                type: "integer",
                minimum: 1,
                maximum: TOURISM_REVIEW_MAX_PAGE_SIZE,
                default: TOURISM_REVIEW_PAGE_SIZE,
            },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["items", "next_cursor"],
            properties: {
                items: { type: "array", items: reviewPublicSchema },
                next_cursor: { type: "string", nullable: true },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        404: notFoundSchema,
    },
};

export const getMyTourismReviewSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "Get the current user's active review for a place",
    description:
        "Authenticated. Returns the author's own pending/published/rejected/hidden review. Never other users' unpublished reviews.",
    security: bearerAuth,
    params: {
        type: "object",
        required: ["placeId"],
        properties: { placeId: { type: "string", format: "uuid" } },
    },
    response: {
        200: {
            oneOf: [reviewOwnerSchema, { type: "null" }],
        },
        401: unauthorizedSchema,
        403: forbiddenWithCodeSchema,
        404: notFoundSchema,
    },
};

export const patchTourismReviewSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "Update own tourism review",
    description: "Editing a published review returns it to pending.",
    security: bearerAuth,
    params: {
        type: "object",
        required: ["reviewId"],
        properties: { reviewId: { type: "string", format: "uuid" } },
    },
    body: {
        type: "object",
        properties: {
            rating: { type: "integer", minimum: 1, maximum: 5 },
            title: { type: "string", nullable: true, minLength: 1, maxLength: 200 },
            body: { type: "string", nullable: true, minLength: 1, maxLength: 5000 },
        },
        additionalProperties: false,
    },
    response: {
        200: reviewOwnerSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenWithCodeSchema,
        404: notFoundSchema,
        409: conflictWithCodeSchema,
    },
};

export const deleteTourismReviewSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "Soft-delete own tourism review",
    security: bearerAuth,
    params: {
        type: "object",
        required: ["reviewId"],
        properties: { reviewId: { type: "string", format: "uuid" } },
    },
    response: {
        200: reviewOwnerSchema,
        401: unauthorizedSchema,
        403: forbiddenWithCodeSchema,
        404: notFoundSchema,
        409: conflictWithCodeSchema,
    },
};

export const patchAdminTourismReviewStatusSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "Change tourism review moderation status",
    description:
        "Admin only. Writes an append-only moderation event and system.audit_logs row. Prefer action endpoints (publish/reject/hide/restore) for transition-safe moderation.",
    security: bearerAuth,
    params: {
        type: "object",
        required: ["reviewId"],
        properties: { reviewId: { type: "string", format: "uuid" } },
    },
    body: {
        type: "object",
        required: ["status"],
        properties: {
            status: { type: "string", enum: [...TOURISM_MODERATION_TARGET_STATUSES] },
            note: { type: "string", nullable: true, minLength: 1, maxLength: 2000 },
        },
        additionalProperties: false,
    },
    response: {
        200: reviewOwnerSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenWithCodeSchema,
        404: notFoundSchema,
        409: conflictWithCodeSchema,
    },
};

const moderationEventSchema = {
    type: "object",
    required: ["from_status", "to_status", "note", "created_at", "actor"],
    properties: {
        from_status: { type: "string", enum: [...TOURISM_REVIEW_STATUS_VALUES] },
        to_status: { type: "string", enum: [...TOURISM_REVIEW_STATUS_VALUES] },
        note: { type: "string", nullable: true },
        created_at: { type: "string", format: "date-time" },
        actor: {
            oneOf: [authorSchema, { type: "null" }],
        },
    },
    additionalProperties: false,
} as const;

const adminReviewDetailSchema = {
    type: "object",
    required: [...reviewOwnerSchema.required, "moderation_history"],
    properties: {
        ...reviewOwnerSchema.properties,
        moderation_history: {
            type: "array",
            items: moderationEventSchema,
        },
    },
    additionalProperties: false,
} as const;

export const getAdminTourismReviewsSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "Admin: list tourism reviews",
    description:
        "Admin only. Filter by status, place, author, and created date range. Cursor pagination.",
    security: bearerAuth,
    querystring: {
        type: "object",
        properties: {
            cursor: { type: "string", minLength: 1, maxLength: 2000 },
            limit: {
                type: "integer",
                minimum: 1,
                maximum: TOURISM_REVIEW_MAX_PAGE_SIZE,
                default: TOURISM_REVIEW_PAGE_SIZE,
            },
            status: { type: "string", enum: [...TOURISM_REVIEW_STATUS_VALUES] },
            placeId: { type: "string", format: "uuid" },
            authorId: { type: "string", format: "uuid" },
            createdFrom: { type: "string" },
            createdTo: { type: "string" },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["items", "next_cursor"],
            properties: {
                items: { type: "array", items: reviewOwnerSchema },
                next_cursor: { type: "string", nullable: true },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenWithCodeSchema,
        404: notFoundSchema,
    },
};

export const getAdminTourismReviewSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "Admin: tourism review detail with moderation history",
    security: bearerAuth,
    params: {
        type: "object",
        required: ["reviewId"],
        properties: { reviewId: { type: "string", format: "uuid" } },
    },
    response: {
        200: adminReviewDetailSchema,
        401: unauthorizedSchema,
        403: forbiddenWithCodeSchema,
        404: notFoundSchema,
    },
};

const adminModerationNoteBody = {
    type: "object",
    properties: {
        note: { type: "string", nullable: true, minLength: 1, maxLength: 2000 },
    },
    additionalProperties: false,
} as const;

const adminActionResponse = {
    200: reviewOwnerSchema,
    400: badRequestSchema,
    401: unauthorizedSchema,
    403: forbiddenWithCodeSchema,
    404: notFoundSchema,
    409: conflictWithCodeSchema,
} as const;

export const postAdminTourismReviewPublishSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "Admin: publish a tourism review",
    description:
        "Admin only. Idempotent when already published. Writes review_moderation_events and system.audit_logs.",
    security: bearerAuth,
    params: {
        type: "object",
        required: ["reviewId"],
        properties: { reviewId: { type: "string", format: "uuid" } },
    },
    body: adminModerationNoteBody,
    response: adminActionResponse,
};

export const postAdminTourismReviewRejectSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "Admin: reject a tourism review",
    description: "Admin only. Optional moderation note. Idempotent when already rejected.",
    security: bearerAuth,
    params: {
        type: "object",
        required: ["reviewId"],
        properties: { reviewId: { type: "string", format: "uuid" } },
    },
    body: adminModerationNoteBody,
    response: adminActionResponse,
};

export const postAdminTourismReviewHideSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "Admin: hide a tourism review",
    description: "Admin only. Optional moderation note. Idempotent when already hidden.",
    security: bearerAuth,
    params: {
        type: "object",
        required: ["reviewId"],
        properties: { reviewId: { type: "string", format: "uuid" } },
    },
    body: adminModerationNoteBody,
    response: adminActionResponse,
};

export const postAdminTourismReviewRestoreSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "Admin: restore a hidden tourism review",
    description:
        "Admin only. Restores hidden → published when published_at is set, otherwise → pending. Deleted reviews cannot be restored.",
    security: bearerAuth,
    params: {
        type: "object",
        required: ["reviewId"],
        properties: { reviewId: { type: "string", format: "uuid" } },
    },
    body: adminModerationNoteBody,
    response: adminActionResponse,
};

export const postRefreshTourismRatingSummarySchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "Refresh tourism rating summary for a place",
    security: bearerAuth,
    params: {
        type: "object",
        required: ["placeId"],
        properties: { placeId: { type: "string", format: "uuid" } },
    },
    response: {
        200: ratingSummarySchema,
        401: unauthorizedSchema,
        403: forbiddenWithCodeSchema,
        404: notFoundSchema,
    },
};

const tourismAddressSchema = {
    type: "object",
    required: ["full_address", "postal_code"],
    properties: {
        full_address: { type: "string" },
        postal_code: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const tourismContactSchema = {
    type: "object",
    required: ["phone", "website", "facebook_url", "opening_hours"],
    properties: {
        phone: { type: "string", nullable: true },
        website: { type: "string", nullable: true },
        facebook_url: { type: "string", nullable: true },
        opening_hours: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

export const getTourismTypesSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "List active tourism types",
    description: "Public. Returns the active tourism taxonomy in display order.",
    response: {
        200: {
            type: "object",
            required: ["items"],
            properties: {
                items: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["code", "name_en", "name_mm", "sort_order"],
                        properties: {
                            code: { type: "string", enum: [...TOURISM_TYPE_CODES] },
                            name_en: { type: "string" },
                            name_mm: { type: "string", nullable: true },
                            sort_order: { type: "integer" },
                        },
                        additionalProperties: false,
                    },
                },
            },
            additionalProperties: false,
        },
    },
};

const tourismPlaceProfilePublicSchema = {
    type: "object",
    required: [
        "public_id",
        "name",
        "name_mm",
        "name_en",
        "display_name",
        "primary_name",
        "lat",
        "lng",
        "category_code",
        "category_name",
        "is_verified",
        "address",
        "contact",
        "tourism_type",
        "short_description",
        "price_level",
        "editor_pick",
        "average_rating",
        "published_review_count",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        display_name: { type: "string", nullable: true },
        primary_name: { type: "string", nullable: true },
        lat: { type: "number", nullable: true },
        lng: { type: "number", nullable: true },
        category_code: { type: "string", nullable: true },
        category_name: { type: "string", nullable: true },
        is_verified: { type: "boolean" },
        address: { oneOf: [tourismAddressSchema, { type: "null" }] },
        contact: { oneOf: [tourismContactSchema, { type: "null" }] },
        tourism_type: { type: "string", enum: [...TOURISM_TYPE_CODES] },
        tourism_type_name_en: { type: "string" },
        tourism_type_name_mm: { type: "string", nullable: true },
        short_description: { type: "string", nullable: true },
        price_level: { type: "integer", minimum: 0, maximum: 4, nullable: true },
        editor_pick: { type: "boolean" },
        average_rating: { type: "number", nullable: true },
        published_review_count: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
} as const;

const tourismPlaceProfileAdminSchema = {
    type: "object",
    required: [
        ...tourismPlaceProfilePublicSchema.required,
        "is_public",
        "editorial_score",
        "manual_boost",
        "season_mode",
        "season_start_month",
        "season_end_month",
        "importance_score",
        "created_at",
        "updated_at",
        "recent_manual_boost_audits",
    ],
    properties: {
        ...tourismPlaceProfilePublicSchema.properties,
        is_public: { type: "boolean" },
        editorial_score: { type: "integer", enum: [...TOURISM_EDITORIAL_SCORES] },
        manual_boost: { type: "integer", minimum: -10, maximum: 10 },
        season_mode: { type: "string", enum: [...TOURISM_SEASON_MODES] },
        season_start_month: { type: "integer", minimum: 1, maximum: 12, nullable: true },
        season_end_month: { type: "integer", minimum: 1, maximum: 12, nullable: true },
        importance_score: { type: "number", minimum: 0, maximum: 100 },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
        recent_manual_boost_audits: {
            type: "array",
            items: {
                type: "object",
                required: ["created_at", "action_type", "manual_boost", "reason"],
                properties: {
                    created_at: { type: "string", format: "date-time" },
                    action_type: { type: "string" },
                    manual_boost: { type: "integer", nullable: true },
                    reason: { type: "string", nullable: true },
                },
                additionalProperties: false,
            },
        },
    },
    additionalProperties: false,
} as const;

export const getTourismPlaceProfileSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "Get public tourism place profile",
    description:
        "Public. Requires an active public core place and a public tourism profile. Localized name via optional lang=my|en. Rating comes from published reviews only.",
    params: {
        type: "object",
        required: ["placeId"],
        properties: { placeId: { type: "string", format: "uuid" } },
    },
    querystring: {
        type: "object",
        properties: {
            lang: { type: "string", enum: ["my", "en"] },
        },
        additionalProperties: false,
    },
    response: {
        200: tourismPlaceProfilePublicSchema,
        400: badRequestSchema,
        404: conflictWithCodeSchema,
    },
};

const tourismRankedPlaceSchema = {
    type: "object",
    required: [
        "public_id",
        "name",
        "name_mm",
        "name_en",
        "display_name",
        "primary_name",
        "lat",
        "lng",
        "is_verified",
        "tourism_type",
        "short_description",
        "price_level",
        "editor_pick",
        "average_rating",
        "published_review_count",
        "distance_meters",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        display_name: { type: "string", nullable: true },
        primary_name: { type: "string", nullable: true },
        lat: { type: "number", nullable: true },
        lng: { type: "number", nullable: true },
        is_verified: { type: "boolean" },
        tourism_type: { type: "string", enum: [...TOURISM_TYPE_CODES] },
        tourism_type_name_en: { type: "string" },
        tourism_type_name_mm: { type: "string", nullable: true },
        short_description: { type: "string", nullable: true },
        price_level: { type: "integer", minimum: 0, maximum: 4, nullable: true },
        editor_pick: { type: "boolean" },
        average_rating: { type: "number", nullable: true },
        published_review_count: { type: "integer", minimum: 0 },
        distance_meters: { type: "number", nullable: true },
    },
    additionalProperties: false,
} as const;

export const getTourismPlacesRankingSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "List ranked tourism places",
    description:
        "Public. Modes: recommended (Bayesian), top_rated (min 5 reviews), most_reviewed, nearby (distance only), editor_picks. Bayesian score is computed at query time and not returned. Only public profiles on active/public places.",
    querystring: {
        type: "object",
        properties: {
            mode: {
                type: "string",
                enum: ["recommended", "top_rated", "most_reviewed", "nearby", "editor_picks"],
                default: "recommended",
            },
            cursor: { type: "string", minLength: 1, maxLength: 2000 },
            limit: {
                type: "integer",
                minimum: 1,
                maximum: TOURISM_REVIEW_MAX_PAGE_SIZE,
                default: TOURISM_REVIEW_PAGE_SIZE,
            },
            lang: { type: "string", enum: ["my", "en"] },
            tourism_type: { type: "string", enum: [...TOURISM_TYPE_CODES] },
            lat: { type: "number", minimum: -90, maximum: 90 },
            lng: { type: "number", minimum: -180, maximum: 180 },
            radius_m: { type: "number", minimum: 1, maximum: 50000 },
            bbox: {
                type: "string",
                description: 'minLng,minLat,maxLng,maxLat',
            },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["mode", "items", "next_cursor"],
            properties: {
                mode: {
                    type: "string",
                    enum: ["recommended", "top_rated", "most_reviewed", "nearby", "editor_picks"],
                },
                items: { type: "array", items: tourismRankedPlaceSchema },
                next_cursor: { type: "string", nullable: true },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
    },
};

export const postAdminTourismPlaceProfileSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "Admin: create tourism place profile",
    description:
        "Admin only. Attaches a tourism overlay to an existing core place. Never creates a duplicate core place. Writes system.audit_logs.",
    security: bearerAuth,
    params: {
        type: "object",
        required: ["placeId"],
        properties: { placeId: { type: "string", format: "uuid" } },
    },
    body: {
        type: "object",
        required: ["tourism_type"],
        properties: {
            tourism_type: { type: "string", enum: [...TOURISM_TYPE_CODES] },
            short_description: { type: "string", nullable: true, minLength: 1, maxLength: 1000 },
            price_level: { type: "integer", minimum: 0, maximum: 4, nullable: true },
            editor_pick: { type: "boolean", default: false },
            is_public: { type: "boolean", default: true },
            editorial_score: {
                type: "integer",
                enum: [...TOURISM_EDITORIAL_SCORES],
                default: 50,
            },
            manual_boost: { type: "integer", minimum: -10, maximum: 10, default: 0 },
            manual_boost_reason: {
                type: "string",
                minLength: 3,
                maxLength: 500,
                nullable: true,
                description: "Required when manual_boost is non-zero. Audited only.",
            },
            season_mode: {
                type: "string",
                enum: [...TOURISM_SEASON_MODES],
                default: "all_year",
            },
            season_start_month: {
                type: "integer",
                minimum: 1,
                maximum: 12,
                nullable: true,
                default: null,
            },
            season_end_month: {
                type: "integer",
                minimum: 1,
                maximum: 12,
                nullable: true,
                default: null,
            },
        },
        additionalProperties: false,
    },
    response: {
        201: tourismPlaceProfileAdminSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenWithCodeSchema,
        404: notFoundSchema,
        409: conflictWithCodeSchema,
    },
};

export const patchAdminTourismPlaceProfileSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "Admin: update tourism place profile",
    description:
        "Admin only. Updates tourism metadata on an existing overlay. Editor picks are manual only. Writes system.audit_logs.",
    security: bearerAuth,
    params: {
        type: "object",
        required: ["placeId"],
        properties: { placeId: { type: "string", format: "uuid" } },
    },
    body: {
        type: "object",
        properties: {
            tourism_type: { type: "string", enum: [...TOURISM_TYPE_CODES] },
            short_description: { type: "string", nullable: true, minLength: 1, maxLength: 1000 },
            price_level: { type: "integer", minimum: 0, maximum: 4, nullable: true },
            editor_pick: { type: "boolean" },
            is_public: { type: "boolean" },
            editorial_score: { type: "integer", enum: [...TOURISM_EDITORIAL_SCORES] },
            manual_boost: { type: "integer", minimum: -10, maximum: 10 },
            manual_boost_reason: {
                type: "string",
                minLength: 3,
                maxLength: 500,
                nullable: true,
                description: "Required when manual_boost is non-zero. Audited only.",
            },
            season_mode: { type: "string", enum: [...TOURISM_SEASON_MODES] },
            season_start_month: {
                type: "integer",
                minimum: 1,
                maximum: 12,
                nullable: true,
            },
            season_end_month: {
                type: "integer",
                minimum: 1,
                maximum: 12,
                nullable: true,
            },
        },
        additionalProperties: false,
    },
    response: {
        200: tourismPlaceProfileAdminSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenWithCodeSchema,
        404: notFoundSchema,
        409: conflictWithCodeSchema,
    },
};

export const tourismReviewErrorSchema = {
    type: "object",
    required: ["message"],
    properties: {
        message: { type: "string" },
        code: { type: "string" },
        issues: badRequestSchema.properties.issues,
    },
    additionalProperties: false,
} as const;

void messageSchema;
void conflictSchema;
void forbiddenSchema;
