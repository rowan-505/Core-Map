import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    forbiddenSchema,
    notFoundSchema,
    unauthorizedSchema,
} from "../../lib/openapi/common.js";

const foodDrinkRankedPlacePublicSchema = {
    type: "object",
    required: [
        "rank",
        "public_id",
        "name",
        "name_mm",
        "name_en",
        "lat",
        "lng",
        "category_code",
        "category_name",
        "category_name_mm",
        "average_rating",
        "published_review_count",
        "distance_meters",
    ],
    properties: {
        rank: { type: "integer", minimum: 1 },
        public_id: { type: "string", format: "uuid" },
        name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        lat: { type: "number" },
        lng: { type: "number" },
        category_code: { type: "string" },
        category_name: { type: "string" },
        category_name_mm: { type: "string", nullable: true },
        average_rating: { type: "number", nullable: true },
        published_review_count: { type: "integer", minimum: 0 },
        distance_meters: { type: "number", nullable: true },
    },
    additionalProperties: false,
} as const;

const foodDrinkRankedPlaceAdminSchema = {
    type: "object",
    required: [
        ...foodDrinkRankedPlacePublicSchema.required,
        "review_score",
        "popularity_score",
        "importance_score",
        "food_score",
    ],
    properties: {
        ...foodDrinkRankedPlacePublicSchema.properties,
        review_score: { type: "number" },
        popularity_score: { type: "number" },
        importance_score: { type: "number" },
        food_score: { type: "number" },
    },
    additionalProperties: false,
} as const;

const recommendationsPageBase = {
    type: "object",
    required: [
        "ranking_group",
        "scope",
        "algorithm_version",
        "township_admin_area_id",
        "township_name",
        "total",
        "limit",
        "offset",
        "items",
    ],
    properties: {
        ranking_group: { type: "string", enum: ["food_drink"] },
        scope: { type: "string", enum: ["township"] },
        algorithm_version: { type: "string" },
        township_admin_area_id: { type: "string" },
        township_name: { type: "string", nullable: true },
        total: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
        offset: { type: "integer", minimum: 0 },
    },
} as const;

const queryParams = {
    type: "object",
    required: ["township_admin_area_id"],
    properties: {
        township_admin_area_id: { type: "string", pattern: "^\\d+$" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        offset: { type: "integer", minimum: 0, default: 0 },
        lang: { type: "string", enum: ["my", "en"] },
        lat: { type: "number", minimum: -90, maximum: 90 },
        lng: { type: "number", minimum: -180, maximum: 180 },
    },
    additionalProperties: false,
} as const;

export const getFoodDrinkRecommendationsSchema: FastifySchema = {
    tags: [Tags.Places],
    summary: "Food & Drink recommendations by township",
    description:
        "Township-only Food & Drink ranking V1. Distance (lat/lng) is display-only and never affects rank.",
    querystring: queryParams,
    response: {
        200: {
            ...recommendationsPageBase,
            properties: {
                ...recommendationsPageBase.properties,
                items: { type: "array", items: foodDrinkRankedPlacePublicSchema },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        404: notFoundSchema,
    },
};

export const getAdminFoodDrinkRecommendationsSchema: FastifySchema = {
    tags: [Tags.Dashboard],
    summary: "Admin Food & Drink township recommendations (with score breakdown)",
    security: bearerAuth,
    querystring: queryParams,
    response: {
        200: {
            ...recommendationsPageBase,
            properties: {
                ...recommendationsPageBase.properties,
                items: { type: "array", items: foodDrinkRankedPlaceAdminSchema },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: forbiddenSchema,
        404: notFoundSchema,
    },
};
