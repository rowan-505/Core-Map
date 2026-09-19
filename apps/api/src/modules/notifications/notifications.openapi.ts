import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    forbiddenSchema,
    messageSchema,
    notFoundSchema,
    unauthorizedSchema,
} from "../../lib/openapi/common.js";
import {
    NOTIFICATION_MAX_PAGE_SIZE,
    NOTIFICATION_PAGE_SIZE,
    NOTIFICATION_TYPES,
} from "./notifications.schema.js";

const actorSchema = {
    type: "object",
    nullable: true,
    required: ["public_id", "display_name"],
    properties: {
        public_id: { type: "string", format: "uuid" },
        display_name: { type: "string" },
    },
    additionalProperties: false,
} as const;

const relatedPostSchema = {
    type: "object",
    nullable: true,
    required: ["public_id", "title", "available"],
    properties: {
        public_id: { type: "string", format: "uuid" },
        title: { type: "string", nullable: true },
        available: { type: "boolean" },
    },
    additionalProperties: false,
} as const;

const itemSchema = {
    type: "object",
    required: [
        "public_id",
        "type",
        "title",
        "message",
        "reaction_type",
        "is_read",
        "created_at",
        "actor",
        "related_post",
    ],
    properties: {
        public_id: { type: "string", format: "uuid" },
        type: { type: "string", enum: [...NOTIFICATION_TYPES] },
        title: { type: "string" },
        message: { type: "string" },
        reaction_type: {
            type: "string",
            enum: ["confirm", "helpful", "incorrect"],
            nullable: true,
        },
        is_read: { type: "boolean" },
        created_at: { type: "string", format: "date-time" },
        actor: actorSchema,
        related_post: relatedPostSchema,
    },
    additionalProperties: false,
} as const;

export const getNotificationsSchema = {
    tags: [Tags.User],
    summary: "List my notifications",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            cursor: { type: "string", minLength: 1, maxLength: 2000 },
            limit: {
                type: "integer",
                minimum: 1,
                maximum: NOTIFICATION_MAX_PAGE_SIZE,
                default: NOTIFICATION_PAGE_SIZE,
            },
            unreadOnly: { type: "boolean", default: false },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["items", "next_cursor"],
            properties: {
                items: { type: "array", items: itemSchema },
                next_cursor: { type: "string", nullable: true },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

export const getNotificationsUnreadCountSchema = {
    tags: [Tags.User],
    summary: "Unread notification count",
    security: [...bearerAuth],
    response: {
        200: {
            type: "object",
            required: ["unread_count"],
            properties: {
                unread_count: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
        },
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

export const patchNotificationReadSchema = {
    tags: [Tags.User],
    summary: "Mark one notification as read",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["publicId"],
        properties: {
            publicId: { type: "string", format: "uuid" },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["public_id", "is_read"],
            properties: {
                public_id: { type: "string", format: "uuid" },
                is_read: { type: "boolean", const: true },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
} satisfies FastifySchema;

export const postNotificationsReadAllSchema = {
    tags: [Tags.User],
    summary: "Mark all notifications as read",
    security: [...bearerAuth],
    response: {
        200: {
            type: "object",
            required: ["updated_count"],
            properties: {
                updated_count: { type: "integer", minimum: 0 },
            },
            additionalProperties: false,
        },
        401: unauthorizedSchema,
        403: forbiddenSchema,
    },
} satisfies FastifySchema;

export const notificationsMessageSchema = messageSchema;
