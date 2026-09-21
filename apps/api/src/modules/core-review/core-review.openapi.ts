import {
    badRequestSchema,
    messageSchema,
    notFoundSchema,
} from "../../lib/openapi/common.js";

const coreReviewErrorResponses = {
    400: badRequestSchema,
    404: notFoundSchema,
    500: messageSchema,
} as const;

export const coreReviewListQuerySchemaOpenApi = {
    type: "object",
    properties: {
        page: { type: "integer", minimum: 1, default: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        search: { type: "string" },
        sortBy: { type: "string" },
        sortOrder: { type: "string", enum: ["asc", "desc"], default: "desc" },
        verification_status: {
            type: "string",
            enum: [
                "unverified",
                "verified",
                "needs_fix",
                "questionable",
                "rejected",
            ],
        },
        /** @deprecated Legacy alias — mapped to verification_status */
        isVerified: { type: "boolean" },
        /** @deprecated Legacy camelCase alias — mapped to verification_status */
        verificationStatus: {
            type: "string",
            enum: [
                "unverified",
                "verified",
                "needs_fix",
                "questionable",
                "rejected",
                "rejected_after_core_review",
            ],
        },
        adminAreaId: { type: "string" },
        categoryId: { type: "string" },
        buildingTypeId: { type: "string" },
        roadClassId: { type: "string" },
        isPublic: { type: "boolean" },
        status: { type: "string", enum: ["active", "deleted", "all"], default: "active" },
        includeDeleted: { type: "boolean" },
        routeId: { type: "string" },
        includeTotal: {
            type: "boolean",
            description:
                "When false, list skips COUNT(*) (streets default). Use meta.hasNextPage and GET /core-review/streets/count.",
        },
        include_total: {
            type: "boolean",
            description: "Snake_case alias for includeTotal.",
        },
        cursorUpdatedAt: { type: "string" },
        cursorId: { type: "string" },
    },
};

const paginationSchema = {
    type: "object",
    required: ["page", "pageSize", "total", "totalPages"],
    properties: {
        page: { type: "integer" },
        pageSize: { type: "integer" },
        total: { type: ["integer", "null"] },
        totalPages: { type: ["integer", "null"] },
    },
};

export const getCoreReviewListSchema = {
    tags: ["core-review"],
    summary: "List core schema entities (paginated)",
    params: {
        type: "object",
        required: ["entity"],
        properties: {
            entity: { type: "string" },
        },
    },
    querystring: coreReviewListQuerySchemaOpenApi,
    response: {
        200: {
            type: "object",
            required: ["data", "pagination"],
            properties: {
                data: { type: "array", items: { type: "object", additionalProperties: true } },
                pagination: paginationSchema,
                filters: { type: "object", additionalProperties: true },
                meta: { type: "object", additionalProperties: true },
            },
        },
        ...coreReviewErrorResponses,
    },
};

export const getCoreReviewStreetsCountSchema = {
    tags: ["core-review"],
    summary: "Count core-review streets for current filters (may be slow)",
    params: {
        type: "object",
        required: ["entity"],
        properties: {
            entity: { type: "string", enum: ["streets"] },
        },
    },
    querystring: coreReviewListQuerySchemaOpenApi,
    response: {
        200: {
            type: "object",
            required: ["total", "verificationCounts"],
            properties: {
                total: { type: "integer" },
                verificationCounts: {
                    type: "object",
                    required: ["total", "verified", "unverified"],
                    properties: {
                        total: { type: "integer" },
                        verified: { type: "integer" },
                        unverified: { type: "integer" },
                    },
                },
                filters: { type: "object", additionalProperties: true },
            },
        },
        ...coreReviewErrorResponses,
    },
};

export const getCoreReviewDetailSchema = {
    tags: ["core-review"],
    summary: "Get core schema entity by id",
    params: {
        type: "object",
        required: ["entity", "id"],
        properties: {
            entity: { type: "string" },
            id: { type: "string" },
        },
    },
    response: {
        200: {
            type: "object",
            required: ["data"],
            properties: {
                data: { type: "object", additionalProperties: true },
            },
        },
        ...coreReviewErrorResponses,
    },
};

const coreReviewWriteBodySchema = {
    type: "object",
    additionalProperties: true,
};

const coreReviewWriteDetailResponse = {
    201: {
        type: "object",
        required: ["data"],
        properties: {
            data: { type: "object", additionalProperties: true },
        },
    },
    200: {
        type: "object",
        required: ["data"],
        properties: {
            data: { type: "object", additionalProperties: true },
        },
    },
    400: badRequestSchema,
    403: messageSchema,
    404: notFoundSchema,
    500: messageSchema,
};

export const postCoreReviewLandAreaPromoteSchema = {
    tags: ["core-review"],
    summary: "Promote a local OSM land area into Core",
    body: {
        type: "object",
        required: ["feature_key", "local_source", "geometry", "class_code"],
        additionalProperties: false,
        properties: {
            feature_key: { type: "string" },
            local_source: { type: "string", enum: ["archive", "base"] },
            class_code: { type: "string" },
            name: { type: ["string", "null"] },
            name_mm: { type: ["string", "null"] },
            name_en: { type: ["string", "null"] },
            geometry: { type: "object", additionalProperties: true },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        201: { type: "object", additionalProperties: true },
        400: badRequestSchema,
        403: messageSchema,
        409: messageSchema,
        500: messageSchema,
    },
} as const;

export const postCoreReviewLandAreaDemoteSchema = {
    tags: ["core-review"],
    summary: "Preflight or hard-remove a Core OSM land area for local demotion",
    description:
        "Does not soft-delete. Removal is a hard delete used only after local Archive is written.",
    body: {
        type: "object",
        required: ["feature_key"],
        additionalProperties: false,
        properties: {
            feature_key: { type: "string" },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: badRequestSchema,
        403: messageSchema,
        404: notFoundSchema,
        409: { type: "object", additionalProperties: true },
        500: messageSchema,
    },
} as const;

export const postCoreReviewLandAreaDeleteSchema = {
    tags: ["core-review"],
    summary: "DELETE a land area from public rendering (identity suppression)",
    description:
        "Writes a tiny render-suppression row and removes Core when safe. Requires confirm=DELETE.",
    body: {
        type: "object",
        required: ["feature_key", "confirm"],
        additionalProperties: false,
        properties: {
            feature_key: { type: "string" },
            confirm: { type: "string", enum: ["DELETE"] },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: badRequestSchema,
        403: messageSchema,
        409: { type: "object", additionalProperties: true },
        500: messageSchema,
    },
} as const;

export const postCoreReviewLandAreaClearSuppressionSchema = {
    tags: ["core-review"],
    summary: "Clear a land-area render suppression so promote can run again",
    body: {
        type: "object",
        required: ["feature_key", "confirm"],
        additionalProperties: false,
        properties: {
            feature_key: { type: "string" },
            confirm: { type: "string", enum: ["CLEAR_SUPPRESSION"] },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: badRequestSchema,
        403: messageSchema,
        500: messageSchema,
    },
} as const;

export const postCoreReviewEntitySchema = {
    tags: ["core-review"],
    summary: "Create core schema entity",
    params: {
        type: "object",
        required: ["entity"],
        properties: {
            entity: { type: "string" },
        },
    },
    body: coreReviewWriteBodySchema,
    response: coreReviewWriteDetailResponse,
};

const coreReviewLifecycleDetailResponse = {
    200: {
        type: "object",
        required: ["data"],
        properties: {
            data: { type: "object", additionalProperties: true },
        },
    },
    400: badRequestSchema,
    403: messageSchema,
    404: notFoundSchema,
    500: messageSchema,
} as const;

export const patchCoreReviewSoftDeleteSchema = {
    tags: ["core-review"],
    summary: "Soft-delete core schema entity",
    params: {
        type: "object",
        required: ["entity", "id"],
        properties: {
            entity: { type: "string" },
            id: { type: "string" },
        },
    },
    response: coreReviewLifecycleDetailResponse,
};

export const patchCoreReviewRestoreSchema = {
    tags: ["core-review"],
    summary: "Restore soft-deleted core schema entity",
    params: {
        type: "object",
        required: ["entity", "id"],
        properties: {
            entity: { type: "string" },
            id: { type: "string" },
        },
    },
    response: coreReviewLifecycleDetailResponse,
};

export const patchCoreReviewEntitySchema = {
    tags: ["core-review"],
    summary: "Update core schema entity",
    params: {
        type: "object",
        required: ["entity", "id"],
        properties: {
            entity: { type: "string" },
            id: { type: "string" },
        },
    },
    body: coreReviewWriteBodySchema,
    response: coreReviewWriteDetailResponse,
};

const coreReviewReferenceOptionItemSchema = {
    type: "object",
    required: ["id", "code", "name"],
    properties: {
        id: { type: "string" },
        code: { type: ["string", "null"] },
        name: { type: ["string", "null"] },
    },
    additionalProperties: false,
};

export const getCoreReviewReferenceOptionsSchema = {
    tags: ["core-review"],
    summary: "Reference dropdown options for Core Review forms",
    response: {
        200: {
            type: "object",
            required: [
                "ref_poi_categories",
                "ref_road_classes",
                "ref_building_types",
                "ref_admin_levels",
                "ref_address_component_types",
                "ref_source_types",
                "core_admin_areas",
            ],
            properties: {
                ref_poi_categories: { type: "array", items: coreReviewReferenceOptionItemSchema },
                ref_road_classes: { type: "array", items: coreReviewReferenceOptionItemSchema },
                ref_building_types: { type: "array", items: coreReviewReferenceOptionItemSchema },
                ref_admin_levels: { type: "array", items: coreReviewReferenceOptionItemSchema },
                ref_address_component_types: { type: "array", items: coreReviewReferenceOptionItemSchema },
                ref_source_types: { type: "array", items: coreReviewReferenceOptionItemSchema },
                core_admin_areas: { type: "array", items: coreReviewReferenceOptionItemSchema },
            },
            additionalProperties: false,
        },
        401: messageSchema,
        500: messageSchema,
    },
};
