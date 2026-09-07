import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    geoJsonGeometrySchema,
    unauthorizedSchema,
} from "../../lib/openapi/common.js";

const fieldForbiddenSchema = {
    type: "object",
    required: ["code", "message"],
    properties: {
        code: { type: "string" },
        message: { type: "string" },
    },
    additionalProperties: false,
} as const;

const fieldRouteSchema = {
    type: "object",
    required: ["publicId", "routeCode", "nameMy", "nameEn"],
    properties: {
        publicId: { type: "string", format: "uuid" },
        routeCode: { type: "string" },
        nameMy: { type: "string", nullable: true },
        nameEn: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const fieldVariantSchema = {
    type: "object",
    required: [
        "publicId",
        "routePublicId",
        "variantCode",
        "directionId",
        "originName",
        "destinationName",
        "oppositeVariantPublicId",
    ],
    properties: {
        publicId: { type: "string", format: "uuid" },
        routePublicId: { type: "string", format: "uuid" },
        variantCode: { type: "string", enum: ["D0", "D1"] },
        directionId: { type: "integer", enum: [0, 1] },
        originName: { type: "string", nullable: true },
        destinationName: { type: "string", nullable: true },
        oppositeVariantPublicId: { type: "string", format: "uuid", nullable: true },
    },
    additionalProperties: false,
} as const;

const fieldStopSchema = {
    type: "object",
    required: ["publicId", "stopCode", "nameMy", "nameEn", "lat", "lng"],
    properties: {
        publicId: { type: "string", format: "uuid" },
        stopCode: { type: "string", nullable: true },
        nameMy: { type: "string", nullable: true },
        nameEn: { type: "string", nullable: true },
        lat: { type: "number" },
        lng: { type: "number" },
    },
    additionalProperties: false,
} as const;

const fieldRouteStopSchema = {
    type: "object",
    required: ["variantPublicId", "stopPublicId", "stopSequence"],
    properties: {
        variantPublicId: { type: "string", format: "uuid" },
        stopPublicId: { type: "string", format: "uuid" },
        stopSequence: { type: "integer", minimum: 1 },
    },
    additionalProperties: false,
} as const;

const fieldRoutePathSchema = {
    type: "object",
    required: ["variantPublicId", "geometry"],
    properties: {
        variantPublicId: { type: "string", format: "uuid" },
        geometry: geoJsonGeometrySchema,
    },
    additionalProperties: false,
} as const;

const fieldBootstrapResponse = {
    oneOf: [
        {
            type: "object",
            required: ["snapshotRevision", "unchanged"],
            properties: {
                snapshotRevision: { type: "string" },
                unchanged: { type: "boolean", enum: [true] },
            },
            additionalProperties: false,
        },
        {
            type: "object",
            required: [
                "snapshotRevision",
                "unchanged",
                "routes",
                "variants",
                "stops",
                "routeStops",
                "routePaths",
            ],
            properties: {
                snapshotRevision: { type: "string" },
                unchanged: { type: "boolean", enum: [false] },
                routes: { type: "array", items: fieldRouteSchema },
                variants: { type: "array", items: fieldVariantSchema },
                stops: { type: "array", items: fieldStopSchema },
                routeStops: { type: "array", items: fieldRouteStopSchema },
                routePaths: { type: "array", items: fieldRoutePathSchema },
            },
            additionalProperties: false,
        },
    ],
} as const;

export const getFieldBootstrapSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Field YBS transport snapshot",
    description:
        "Authenticated surveyor-only compact YBS bus snapshot. Send `revision` to keep a cached copy when it matches `snapshotRevision`. Public UUIDs only. The process gzips JSON when Accept-Encoding includes gzip. D0 and D1 always come from the same snapshotRevision.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            revision: {
                type: "string",
                minLength: 1,
                maxLength: 80,
                description: "Client snapshotRevision from the last successful download.",
            },
        },
        additionalProperties: false,
    },
    response: {
        200: fieldBootstrapResponse,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: fieldForbiddenSchema,
    },
};

const fieldReportResponse = {
    type: "object",
    required: [
        "publicId",
        "reportTypeCode",
        "statusCode",
        "sourceCode",
        "observedAt",
        "location",
        "target",
        "context",
        "description",
        "adminAreaId",
        "surveySessionPublicId",
        "createdAt",
        "updatedAt",
    ],
    properties: {
        publicId: { type: "string", format: "uuid" },
        reportTypeCode: { type: "string" },
        statusCode: { type: "string" },
        sourceCode: { type: "string", enum: ["field_survey"] },
        observedAt: { type: "string", format: "date-time" },
        location: {
            type: "object",
            required: ["lat", "lng", "accuracyM"],
            properties: {
                lat: { type: "number" },
                lng: { type: "number" },
                accuracyM: { type: "number", nullable: true },
            },
            additionalProperties: false,
        },
        target: {
            type: "object",
            required: ["entityType", "publicId"],
            properties: {
                entityType: { type: "string", nullable: true },
                publicId: { type: "string", format: "uuid", nullable: true },
            },
            additionalProperties: false,
        },
        context: { type: "object", additionalProperties: true },
        description: { type: "string" },
        adminAreaId: { type: "string", nullable: true },
        surveySessionPublicId: { type: "string", format: "uuid", nullable: true },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
} as const;

const fieldReportCreateBody = {
    type: "object",
    required: ["clientPublicId", "reportTypeCode", "observedAt", "location", "target", "context"],
    properties: {
        clientPublicId: { type: "string", format: "uuid" },
        reportTypeCode: { type: "string" },
        observedAt: { type: "string", format: "date-time" },
        location: {
            type: "object",
            required: ["lat", "lng"],
            properties: {
                lat: { type: "number" },
                lng: { type: "number" },
                accuracyM: { type: "number", nullable: true },
            },
            additionalProperties: false,
        },
        target: {
            type: "object",
            required: ["entityType"],
            properties: {
                entityType: { type: "string", enum: ["stop", "route", "variant", "path"] },
                publicId: { type: "string", format: "uuid" },
            },
            additionalProperties: false,
        },
        context: {
            type: "object",
            required: ["snapshotRevision", "variantCode"],
            properties: {
                snapshotRevision: { type: "string" },
                routePublicId: { type: "string", format: "uuid" },
                variantPublicId: { type: "string", format: "uuid" },
                variantCode: { type: "string", enum: ["D0", "D1"] },
                stopPublicId: { type: "string", format: "uuid" },
                stopSequence: { type: "integer" },
                canonicalSnapshot: { type: "object" },
            },
            additionalProperties: false,
        },
        surveySession: {
            oneOf: [
                {
                    type: "object",
                    required: ["publicId"],
                    properties: { publicId: { type: "string", format: "uuid" } },
                    additionalProperties: false,
                },
                {
                    type: "object",
                    required: ["clientSessionId"],
                    properties: { clientSessionId: { type: "string", format: "uuid" } },
                    additionalProperties: false,
                },
            ],
        },
        description: { type: "string" },
        note: { type: "string" },
    },
    additionalProperties: false,
} as const;

const fieldPublicIdParams = {
    type: "object",
    required: ["publicId"],
    properties: { publicId: { type: "string", format: "uuid" } },
    additionalProperties: false,
} as const;

const fieldConflictSchema = fieldForbiddenSchema;

export const postFieldReportSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Submit a field anomaly",
    description:
        "Surveyor-only. Writes one feedback.user_reports row with source_code=field_survey. clientPublicId is the idempotency key. An optional surveySession public or client UUID links an owned, route-compatible session. Distinct UUIDs are distinct anomalies. Does not use public POST /reports duplicate collapse or daily caps. Does not change canonical transport.",
    security: [...bearerAuth],
    body: fieldReportCreateBody,
    response: {
        200: fieldReportResponse,
        201: fieldReportResponse,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: fieldForbiddenSchema,
        404: fieldConflictSchema,
        409: fieldConflictSchema,
        429: fieldForbiddenSchema,
    },
};

export const getFieldReportSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Get a field anomaly",
    security: [...bearerAuth],
    params: fieldPublicIdParams,
    response: {
        200: fieldReportResponse,
        401: unauthorizedSchema,
        403: fieldForbiddenSchema,
        404: { type: "object", required: ["message"], properties: { message: { type: "string" } }, additionalProperties: false },
    },
};

export const patchFieldReportSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Correct a submitted field anomaly",
    description: "Creator may edit while status is submitted. in_review, resolved, and rejected are locked.",
    security: [...bearerAuth],
    params: fieldPublicIdParams,
    body: {
        type: "object",
        properties: {
            observedAt: { type: "string", format: "date-time" },
            location: {
                type: "object",
                required: ["lat", "lng"],
                properties: {
                    lat: { type: "number" },
                    lng: { type: "number" },
                    accuracyM: { type: "number", nullable: true },
                },
                additionalProperties: false,
            },
            reportTypeCode: { type: "string" },
            target: {
                type: "object",
                required: ["entityType"],
                properties: {
                    entityType: { type: "string", enum: ["stop", "route", "variant", "path"] },
                    publicId: { type: "string", format: "uuid" },
                },
                additionalProperties: false,
            },
            context: { type: "object" },
            description: { type: "string" },
            note: { type: "string" },
        },
        additionalProperties: false,
    },
    response: {
        200: fieldReportResponse,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: fieldForbiddenSchema,
        404: { type: "object", required: ["message"], properties: { message: { type: "string" } }, additionalProperties: false },
        409: fieldConflictSchema,
    },
};

export const postFieldReportFollowupSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Add a field report follow-up",
    description: "Append-only. Closed reports cannot receive follow-ups. Does not change canonical transport.",
    security: [...bearerAuth],
    params: fieldPublicIdParams,
    body: {
        type: "object",
        required: ["message"],
        properties: { message: { type: "string", minLength: 1, maxLength: 2000 } },
        additionalProperties: false,
    },
    response: {
        201: fieldReportResponse,
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: fieldForbiddenSchema,
        404: { type: "object", required: ["message"], properties: { message: { type: "string" } }, additionalProperties: false },
        409: fieldConflictSchema,
    },
};

const surveySessionErrorSchema = {
    type: "object",
    required: ["code", "message"],
    properties: {
        code: { type: "string" },
        message: { type: "string" },
        issues: {},
    },
    additionalProperties: false,
} as const;

const surveySessionResponseSchema = {
    type: "object",
    required: [
        "publicId",
        "clientSessionId",
        "snapshotRevision",
        "startedAt",
        "endedAt",
        "status",
        "route",
        "variant",
        "reportCount",
        "createdAt",
        "updatedAt",
    ],
    properties: {
        publicId: { type: "string", format: "uuid" },
        clientSessionId: { type: "string", format: "uuid" },
        snapshotRevision: { type: "string" },
        startedAt: { type: "string", format: "date-time" },
        endedAt: { type: "string", format: "date-time", nullable: true },
        status: { type: "string", enum: ["active", "completed", "abandoned"] },
        route: {
            type: "object",
            required: ["publicId", "code"],
            properties: {
                publicId: { type: "string", format: "uuid" },
                code: { type: "string" },
            },
            additionalProperties: false,
        },
        variant: {
            type: "object",
            required: ["publicId", "code", "origin", "destination"],
            properties: {
                publicId: { type: "string", format: "uuid" },
                code: { type: "string", enum: ["D0", "D1"] },
                origin: { type: "string", nullable: true },
                destination: { type: "string", nullable: true },
            },
            additionalProperties: false,
        },
        reportCount: { type: "integer", minimum: 0 },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
} as const;

const surveySessionAuthErrors = {
    400: surveySessionErrorSchema,
    401: surveySessionErrorSchema,
    403: fieldForbiddenSchema,
    404: surveySessionErrorSchema,
    409: surveySessionErrorSchema,
} as const;

export const postSurveySessionSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Start a field survey session",
    description:
        "Surveyor-only and idempotent by clientSessionId. The API resolves the public route variant UUID to its private database key.",
    security: [...bearerAuth],
    body: {
        type: "object",
        required: ["clientSessionId", "routeVariantPublicId", "snapshotRevision", "startedAt"],
        properties: {
            clientSessionId: { type: "string", format: "uuid" },
            routeVariantPublicId: { type: "string", format: "uuid" },
            snapshotRevision: { type: "string", minLength: 1, maxLength: 80 },
            startedAt: { type: "string", format: "date-time" },
        },
        additionalProperties: false,
    },
    response: { 200: surveySessionResponseSchema, 201: surveySessionResponseSchema, ...surveySessionAuthErrors },
};

export const getSurveySessionsSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "List the surveyor's survey sessions",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            cursor: { type: "string", minLength: 1, maxLength: 2000 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["items", "nextCursor"],
            properties: {
                items: { type: "array", items: surveySessionResponseSchema },
                nextCursor: { type: "string", nullable: true },
            },
            additionalProperties: false,
        },
        ...surveySessionAuthErrors,
    },
};

const surveySessionPublicIdParams = {
    type: "object",
    required: ["publicId"],
    properties: { publicId: { type: "string", format: "uuid" } },
    additionalProperties: false,
} as const;

const surveySessionClientIdParams = {
    type: "object",
    required: ["clientSessionId"],
    properties: { clientSessionId: { type: "string", format: "uuid" } },
    additionalProperties: false,
} as const;

export const getSurveySessionSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Get one owned survey session",
    security: [...bearerAuth],
    params: surveySessionPublicIdParams,
    response: { 200: surveySessionResponseSchema, ...surveySessionAuthErrors },
};

const surveySessionEndBody = {
    type: "object",
    required: ["endedAt"],
    properties: { endedAt: { type: "string", format: "date-time" } },
    additionalProperties: false,
} as const;

export const patchSurveySessionCompleteSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Complete an active survey session",
    description: "Retry-safe: completing an already-completed session returns its original terminal state.",
    security: [...bearerAuth],
    params: surveySessionClientIdParams,
    body: surveySessionEndBody,
    response: { 200: surveySessionResponseSchema, ...surveySessionAuthErrors },
};

export const patchSurveySessionAbandonSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Abandon an active survey session",
    description: "Retry-safe: abandoning an already-abandoned session returns its original terminal state.",
    security: [...bearerAuth],
    params: surveySessionClientIdParams,
    body: surveySessionEndBody,
    response: { 200: surveySessionResponseSchema, ...surveySessionAuthErrors },
};
