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
    COMMUNITY_FEEDS,
    COMMUNITY_MAX_PAGE_SIZE,
    COMMUNITY_MODERATION_ACTIONS,
    COMMUNITY_PAGE_SIZE,
    COMMUNITY_REACTIONS,
} from "./community.schema.js";

const authorSchema = {
    type: "object",
    required: ["public_id", "display_name"],
    properties: {
        public_id: { type: "string", format: "uuid" },
        display_name: { type: "string" },
    },
    additionalProperties: false,
} as const;

const reactionCountsSchema = {
    type: "object",
    required: ["confirm", "helpful", "incorrect"],
    properties: {
        confirm: { type: "integer" },
        helpful: { type: "integer" },
        incorrect: { type: "integer" },
    },
    additionalProperties: false,
} as const;

const listItemSchema = {
    type: "object",
    required: [
        "public_id",
        "title",
        "description_preview",
        "category",
        "publication_status",
        "verification_status",
        "trust_score",
        "published_at",
        "has_location",
        "location",
        "author",
        "reaction_counts",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        title: { type: "string" },
        description_preview: { type: "string" },
        category: { type: "string" },
        publication_status: {
            type: "string",
            enum: ["published", "resolved", "expired", "rejected", "removed"],
        },
        verification_status: {
            type: "string",
            enum: ["unverified", "community_confirmed", "admin_verified"],
        },
        trust_score: { type: "integer" },
        published_at: { type: "string", format: "date-time" },
        has_location: { type: "boolean" },
        location: {
            type: "object",
            nullable: true,
            required: ["lng", "lat", "label"],
            properties: {
                lng: { type: "number" },
                lat: { type: "number" },
                label: { type: "string", nullable: true },
            },
            additionalProperties: false,
        },
        author: authorSchema,
        reaction_counts: reactionCountsSchema,
    },
    additionalProperties: false,
} as const;

const detailSchema = {
    type: "object",
    required: [
        ...listItemSchema.required,
        "description",
        "updated_at",
        "viewer_reaction",
    ],
    properties: {
        ...listItemSchema.properties,
        description: { type: "string" },
        updated_at: { type: "string", format: "date-time" },
        viewer_reaction: {
            type: "string",
            enum: [...COMMUNITY_REACTIONS],
            nullable: true,
        },
        location: {
            type: "object",
            nullable: true,
            required: ["lng", "lat", "label"],
            properties: {
                lng: { type: "number" },
                lat: { type: "number" },
                label: { type: "string", nullable: true },
            },
            additionalProperties: false,
        },
    },
    additionalProperties: false,
} as const;

const pageSchema = {
    type: "object",
    required: ["items", "next_cursor"],
    properties: {
        items: { type: "array", items: listItemSchema },
        next_cursor: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const publicIdParams = {
    type: "object",
    required: ["publicId"],
    properties: {
        publicId: { type: "string", format: "uuid" },
    },
    additionalProperties: false,
} as const;

const locationBody = {
    type: "object",
    required: ["lng", "lat"],
    properties: {
        lng: { type: "number", minimum: -180, maximum: 180 },
        lat: { type: "number", minimum: -90, maximum: 90 },
        label: { type: "string", maxLength: 240 },
    },
    additionalProperties: false,
} as const;

export const getCommunityPostsSchema = {
    tags: [Tags.Community],
    summary: "List community posts",
    description:
        "Public Latest/Trusted feed with cursor pagination. Uses public_id only. bbox only matches posts with location.",
    querystring: {
        type: "object",
        properties: {
            feed: { type: "string", enum: [...COMMUNITY_FEEDS], default: "latest" },
            cursor: { type: "string", minLength: 1, maxLength: 2000 },
            limit: {
                type: "integer",
                minimum: 1,
                maximum: COMMUNITY_MAX_PAGE_SIZE,
                default: COMMUNITY_PAGE_SIZE,
            },
            category: { type: "string", minLength: 1, maxLength: 120 },
            bbox: {
                type: "string",
                description: "west,south,east,north (only posts with location)",
            },
        },
        additionalProperties: false,
    },
    response: {
        200: pageSchema,
        400: badRequestSchema,
    },
} satisfies FastifySchema;

export const getCommunityPostSchema = {
    tags: [Tags.Community],
    summary: "Get community post detail",
    params: publicIdParams,
    security: [],
    response: {
        200: detailSchema,
        400: badRequestSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const postCommunityPostSchema = {
    tags: [Tags.Community],
    summary: "Create community post",
    security: [...bearerAuth],
    body: {
        type: "object",
        required: ["title", "description", "category"],
        properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: "string", minLength: 1, maxLength: 5000 },
            category: { type: "string", minLength: 1, maxLength: 120 },
            location: { ...locationBody, nullable: true },
        },
        additionalProperties: false,
    },
    response: {
        201: detailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

export const patchCommunityPostSchema = {
    tags: [Tags.Community],
    summary: "Update own community post",
    security: [...bearerAuth],
    params: publicIdParams,
    body: {
        type: "object",
        properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: "string", minLength: 1, maxLength: 5000 },
            category: { type: "string", minLength: 1, maxLength: 120 },
            location: { ...locationBody, nullable: true },
        },
        additionalProperties: false,
    },
    response: {
        200: detailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
    },
} satisfies FastifySchema;

export const deleteCommunityPostSchema = {
    tags: [Tags.Community],
    summary: "Soft-delete own community post",
    security: [...bearerAuth],
    params: publicIdParams,
    response: {
        200: {
            type: "object",
            required: ["ok"],
            properties: { ok: { type: "boolean", const: true } },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
    },
} satisfies FastifySchema;

export const putCommunityReactionSchema = {
    tags: [Tags.Community],
    summary: "Upsert reaction on a post",
    security: [...bearerAuth],
    params: publicIdParams,
    body: {
        type: "object",
        required: ["reactionType"],
        properties: {
            reactionType: { type: "string", enum: [...COMMUNITY_REACTIONS] },
        },
        additionalProperties: false,
    },
    response: {
        200: detailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
    },
} satisfies FastifySchema;

export const deleteCommunityReactionSchema = {
    tags: [Tags.Community],
    summary: "Remove own reaction from a post",
    security: [...bearerAuth],
    params: publicIdParams,
    response: {
        200: detailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
    },
} satisfies FastifySchema;

export const getMyCommunityPostsSchema = {
    tags: [Tags.User],
    summary: "My community posts",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            cursor: { type: "string", minLength: 1, maxLength: 2000 },
            limit: {
                type: "integer",
                minimum: 1,
                maximum: COMMUNITY_MAX_PAGE_SIZE,
                default: COMMUNITY_PAGE_SIZE,
            },
        },
        additionalProperties: false,
    },
    response: {
        200: pageSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

export const getAdminCommunityPostsSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: community moderation queue",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            cursor: { type: "string", minLength: 1, maxLength: 2000 },
            limit: {
                type: "integer",
                minimum: 1,
                maximum: COMMUNITY_MAX_PAGE_SIZE,
                default: COMMUNITY_PAGE_SIZE,
            },
            publicationStatus: {
                type: "string",
                enum: ["published", "resolved", "expired", "rejected", "removed"],
            },
            verificationStatus: {
                type: "string",
                enum: ["unverified", "community_confirmed", "admin_verified"],
            },
            trustedOnly: { type: "boolean", default: false },
            closedOnly: { type: "boolean", default: false },
            category: { type: "string", minLength: 1, maxLength: 120 },
            search: { type: "string", minLength: 1, maxLength: 200 },
            sort: {
                type: "string",
                enum: ["published_at_desc", "published_at_asc"],
                default: "published_at_desc",
            },
        },
        additionalProperties: false,
    },
    response: {
        200: pageSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

export const getAdminCommunityCountsSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: community queue counts",
    description:
        "Lightweight badge counts for Needs Review, Live Posts, Trusted, and Closed workflows.",
    security: [...bearerAuth],
    response: {
        200: {
            type: "object",
            required: ["needs_review", "live", "trusted", "closed"],
            properties: {
                needs_review: { type: "integer", minimum: 0 },
                live: { type: "integer", minimum: 0 },
                trusted: { type: "integer", minimum: 0 },
                closed: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
        },
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

const moderationEventSchema = {
    type: "object",
    required: [
        "public_id",
        "action_code",
        "from_publication_status",
        "to_publication_status",
        "from_verification_status",
        "to_verification_status",
        "note",
        "created_at",
        "actor",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        action_code: { type: "string" },
        from_publication_status: { type: "string", nullable: true },
        to_publication_status: { type: "string", nullable: true },
        from_verification_status: { type: "string", nullable: true },
        to_verification_status: { type: "string", nullable: true },
        note: { type: "string", nullable: true },
        created_at: { type: "string", format: "date-time" },
        actor: {
            type: "object",
            nullable: true,
            required: ["public_id", "display_name"],
            properties: {
                public_id: { type: "string", format: "uuid" },
                display_name: { type: "string" },
            },
            additionalProperties: false,
        },
    },
    additionalProperties: false,
} as const;

const adminDetailSchema = {
    type: "object",
    required: [
        ...detailSchema.required,
        "created_at",
        "moderation_history",
    ],
    properties: {
        ...detailSchema.properties,
        created_at: { type: "string", format: "date-time" },
        moderation_history: {
            type: "array",
            items: moderationEventSchema,
        },
    },
    additionalProperties: false,
} as const;

export const getAdminCommunityPostSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: community post detail with moderation history",
    security: [...bearerAuth],
    params: publicIdParams,
    response: {
        200: adminDetailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const postAdminCommunityModerationSchema = {
    tags: [Tags.Dashboard],
    summary: "Admin: moderate community post",
    description:
        "Applies a lifecycle/verification transition. Runtime requires a non-empty `note` for reject, remove, and expire (400 NOTE_REQUIRED).",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["publicId", "action"],
        properties: {
            publicId: { type: "string", format: "uuid" },
            action: { type: "string", enum: [...COMMUNITY_MODERATION_ACTIONS] },
        },
        additionalProperties: false,
    },
    body: {
        type: "object",
        properties: {
            note: {
                type: "string",
                maxLength: 1000,
                description:
                    "Required for reject, remove, and expire. Optional for verify, unverify, resolve, and reopen.",
            },
        },
        additionalProperties: false,
    },
    response: {
        200: detailSchema,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
        409: conflictSchema,
    },
} satisfies FastifySchema;

export const communityErrorMessageSchema = messageSchema;
