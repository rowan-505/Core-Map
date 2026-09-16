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
        "Authenticated surveyor-only compact YBS bus snapshot served from a prebuilt gzip artifact. Send `revision` to keep a cached copy when it matches `snapshotRevision` (`{ unchanged: true }`, HTTP 200). Send If-None-Match for HTTP 304. The request path never rebuilds the snapshot. Public UUIDs only. D0 and D1 always come from the same snapshotRevision.",
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
        304: { type: "null", description: "ETag matches If-None-Match" },
        400: badRequestSchema,
        401: unauthorizedSchema,
        403: fieldForbiddenSchema,
        503: fieldForbiddenSchema,
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
                previousStopPublicId: { type: "string", format: "uuid" },
                previousStopSequence: { type: "integer" },
                nextStopPublicId: { type: "string", format: "uuid" },
                proposedStopName: { type: "string" },
                locationSource: { type: "string", enum: ["GPS", "MAP_PICK"] },
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
        "stoppedAt",
        "endedAt",
        "status",
        "trackingState",
        "completionStatus",
        "accumulatedActiveSeconds",
        "finishedAt",
        "reopenedAt",
        "lastActivityAt",
        "lastCheckedStopSequence",
        "checkedStopCount",
        "totalStopCount",
        "reportCount",
        "pendingSyncCount",
        "lastGpsAccuracyM",
        "lastLat",
        "lastLng",
        "lastGpsAt",
        "clientSyncState",
        "route",
        "variant",
        "createdAt",
        "updatedAt",
    ],
    properties: {
        publicId: { type: "string", format: "uuid" },
        clientSessionId: { type: "string", format: "uuid" },
        snapshotRevision: { type: "string" },
        startedAt: { type: "string", format: "date-time" },
        stoppedAt: { type: "string", format: "date-time", nullable: true },
        endedAt: { type: "string", format: "date-time", nullable: true },
        status: { type: "string", enum: ["active", "completed", "abandoned"] },
        trackingState: { type: "string", enum: ["idle", "active"] },
        completionStatus: { type: "string", enum: ["partial", "finished"] },
        accumulatedActiveSeconds: { type: "integer", minimum: 0 },
        finishedAt: { type: "string", format: "date-time", nullable: true },
        reopenedAt: { type: "string", format: "date-time", nullable: true },
        lastActivityAt: { type: "string", format: "date-time", nullable: true },
        lastCheckedStopSequence: { type: "integer", nullable: true },
        checkedStopCount: { type: "integer", minimum: 0 },
        totalStopCount: { type: "integer", minimum: 0 },
        reportCount: { type: "integer", minimum: 0 },
        pendingSyncCount: { type: "integer", minimum: 0 },
        lastGpsAccuracyM: { type: "number", nullable: true },
        lastLat: { type: "number", nullable: true },
        lastLng: { type: "number", nullable: true },
        lastGpsAt: { type: "string", format: "date-time", nullable: true },
        clientSyncState: { type: "string", nullable: true },
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

const surveySessionSummaryBody = {
    type: "object",
    required: [
        "accumulatedActiveSeconds",
        "lastActivityAt",
        "checkedStopCount",
        "totalStopCount",
        "pendingSyncCount",
    ],
    properties: {
        accumulatedActiveSeconds: { type: "integer", minimum: 0 },
        lastActivityAt: { type: "string", format: "date-time" },
        lastCheckedStopSequence: { type: "integer", nullable: true },
        checkedStopCount: { type: "integer", minimum: 0 },
        totalStopCount: { type: "integer", minimum: 0 },
        pendingSyncCount: { type: "integer", minimum: 0 },
        lastGpsAccuracyM: { type: "number", nullable: true },
        lastLat: { type: "number", nullable: true },
        lastLng: { type: "number", nullable: true },
        lastGpsAt: { type: "string", format: "date-time", nullable: true },
        clientSyncState: { type: "string", minLength: 1, maxLength: 40 },
    },
    additionalProperties: false,
} as const;

export const patchSurveySessionSummarySchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Sync operational survey session summary",
    description:
        "Lightweight heartbeat/summary sync. Last GPS point is overwrite-only and accepted only while tracking is active.",
    security: [...bearerAuth],
    params: surveySessionClientIdParams,
    body: surveySessionSummaryBody,
    response: { 200: surveySessionResponseSchema, ...surveySessionAuthErrors },
};

export const patchSurveySessionFinishSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Mark survey session finished",
    description: "Idempotent personal completion. Stops tracking if still active. Zero reports allowed.",
    security: [...bearerAuth],
    params: surveySessionClientIdParams,
    body: {
        type: "object",
        required: ["finishedAt"],
        properties: {
            finishedAt: { type: "string", format: "date-time" },
            stoppedAt: { type: "string", format: "date-time" },
            accumulatedActiveSeconds: { type: "integer", minimum: 0 },
            clientEventId: { type: "string", format: "uuid" },
        },
        additionalProperties: false,
    },
    response: { 200: surveySessionResponseSchema, ...surveySessionAuthErrors },
};

export const patchSurveySessionReopenSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Reopen a finished survey session to partial",
    description: "Idempotent. Does not restart GPS tracking.",
    security: [...bearerAuth],
    params: surveySessionClientIdParams,
    body: {
        type: "object",
        required: ["reopenedAt"],
        properties: {
            reopenedAt: { type: "string", format: "date-time" },
            clientEventId: { type: "string", format: "uuid" },
        },
        additionalProperties: false,
    },
    response: { 200: surveySessionResponseSchema, ...surveySessionAuthErrors },
};

const surveyCompletionResponseSchema = {
    type: "object",
    required: [
        "routeVariantPublicId",
        "route",
        "variantCode",
        "finished",
        "finishedAt",
        "updatedAt",
    ],
    properties: {
        routeVariantPublicId: { type: "string", format: "uuid" },
        route: {
            type: "object",
            required: ["publicId", "code"],
            properties: {
                publicId: { type: "string", format: "uuid" },
                code: { type: "string" },
            },
            additionalProperties: false,
        },
        variantCode: { type: "string", enum: ["D0", "D1"] },
        finished: { type: "boolean" },
        finishedAt: { type: "string", format: "date-time", nullable: true },
        updatedAt: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
} as const;

export const getSurveyCompletionsSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "List personal survey variant completion marks",
    security: [...bearerAuth],
    response: {
        200: {
            type: "object",
            required: ["items"],
            properties: {
                items: { type: "array", items: surveyCompletionResponseSchema },
            },
            additionalProperties: false,
        },
        ...surveySessionAuthErrors,
    },
};

export const putSurveyCompletionSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Set personal finished mark for one route variant",
    description: "Idempotent PUT. Does not require reports. Does not change transport data.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["routeVariantPublicId"],
        properties: { routeVariantPublicId: { type: "string", format: "uuid" } },
        additionalProperties: false,
    },
    body: {
        type: "object",
        required: ["finished"],
        properties: { finished: { type: "boolean" } },
        additionalProperties: false,
    },
    response: { 200: surveyCompletionResponseSchema, ...surveySessionAuthErrors },
};

const surveyAssignmentResponseSchema = {
    type: "object",
    required: [
        "publicId",
        "surveyorPublicId",
        "assignedByPublicId",
        "routeVariantPublicId",
        "route",
        "variantCode",
        "assignedDate",
        "dueDate",
        "status",
        "cancelledAt",
        "workStatus",
        "remaining",
        "createdAt",
        "updatedAt",
    ],
    properties: {
        publicId: { type: "string", format: "uuid" },
        surveyorPublicId: { type: "string", format: "uuid" },
        assignedByPublicId: { type: "string", format: "uuid" },
        routeVariantPublicId: { type: "string", format: "uuid" },
        route: {
            type: "object",
            required: ["publicId", "code"],
            properties: {
                publicId: { type: "string", format: "uuid" },
                code: { type: "string" },
            },
            additionalProperties: false,
        },
        variantCode: { type: "string", enum: ["D0", "D1"] },
        assignedDate: { type: "string", format: "date" },
        dueDate: { type: "string", format: "date", nullable: true },
        status: { type: "string", enum: ["active", "cancelled"] },
        cancelledAt: { type: "string", format: "date-time", nullable: true },
        workStatus: { type: "string", enum: ["not_started", "partial", "finished"] },
        remaining: { type: "boolean" },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
} as const;

export const getSurveyAssignmentsSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "List survey route-variant assignments",
    description:
        "Surveyors see their own active assignments only. Administrators may filter and include cancelled rows.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            status: { type: "string", enum: ["active", "cancelled", "all"], default: "active" },
            surveyorPublicId: { type: "string", format: "uuid" },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["items"],
            properties: {
                items: { type: "array", items: surveyAssignmentResponseSchema },
            },
            additionalProperties: false,
        },
        ...surveySessionAuthErrors,
    },
};

export const postSurveyAssignmentSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Create a survey route-variant assignment",
    description: "Administrator only. Assigns D0/D1 independently via routeVariantPublicId.",
    security: [...bearerAuth],
    body: {
        type: "object",
        required: ["surveyorPublicId", "routeVariantPublicId", "assignedDate"],
        properties: {
            surveyorPublicId: { type: "string", format: "uuid" },
            routeVariantPublicId: { type: "string", format: "uuid" },
            assignedDate: { type: "string", format: "date" },
            dueDate: { type: "string", format: "date", nullable: true },
        },
        additionalProperties: false,
    },
    response: {
        201: surveyAssignmentResponseSchema,
        ...surveySessionAuthErrors,
        409: {
            type: "object",
            required: ["code", "message"],
            properties: { code: { type: "string" }, message: { type: "string" } },
            additionalProperties: false,
        },
    },
};

export const patchSurveyAssignmentSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Update an active survey assignment",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["publicId"],
        properties: { publicId: { type: "string", format: "uuid" } },
        additionalProperties: false,
    },
    body: {
        type: "object",
        properties: {
            assignedDate: { type: "string", format: "date" },
            dueDate: { type: "string", format: "date", nullable: true },
        },
        additionalProperties: false,
    },
    response: { 200: surveyAssignmentResponseSchema, ...surveySessionAuthErrors },
};

export const postSurveyAssignmentCancelSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Cancel a survey assignment",
    description: "Idempotent cancel. Does not delete history.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["publicId"],
        properties: { publicId: { type: "string", format: "uuid" } },
        additionalProperties: false,
    },
    response: { 200: surveyAssignmentResponseSchema, ...surveySessionAuthErrors },
};

const surveyActivityItemSchema = {
    type: "object",
    required: [
        "assignmentPublicId",
        "surveyor",
        "route",
        "variantCode",
        "routeVariantPublicId",
        "assignedDate",
        "workStatus",
        "remaining",
        "presence",
        "lastCheckedStopSequence",
        "checkedStopCount",
        "totalStopCount",
        "checkedLabel",
        "reportCount",
        "pendingSyncCount",
        "startedAt",
        "activeDurationSeconds",
        "lastActivityAt",
        "syncState",
    ],
    properties: {
        assignmentPublicId: { type: "string", format: "uuid" },
        surveyor: {
            type: "object",
            required: ["publicId", "displayName", "email"],
            properties: {
                publicId: { type: "string", format: "uuid" },
                displayName: { type: "string" },
                email: { type: "string" },
            },
            additionalProperties: false,
        },
        route: {
            type: "object",
            required: ["publicId", "code"],
            properties: {
                publicId: { type: "string", format: "uuid" },
                code: { type: "string" },
            },
            additionalProperties: false,
        },
        variantCode: { type: "string", enum: ["D0", "D1"] },
        routeVariantPublicId: { type: "string", format: "uuid" },
        assignedDate: { type: "string", format: "date" },
        workStatus: { type: "string", enum: ["not_started", "partial", "finished"] },
        remaining: { type: "boolean" },
        presence: {
            type: "object",
            required: ["kind", "label", "activeNow"],
            properties: {
                kind: { type: "string", enum: ["active_now", "last_seen", "none"] },
                label: { type: "string" },
                activeNow: { type: "boolean" },
            },
            additionalProperties: false,
        },
        lastCheckedStopSequence: { type: "integer", nullable: true },
        checkedStopCount: { type: "integer" },
        totalStopCount: { type: "integer" },
        checkedLabel: { type: "string" },
        reportCount: { type: "integer" },
        pendingSyncCount: { type: "integer" },
        startedAt: { type: "string", format: "date-time", nullable: true },
        activeDurationSeconds: { type: "integer" },
        lastActivityAt: { type: "string", format: "date-time", nullable: true },
        syncState: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

export const getSurveyActivitySchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Admin Field Survey Activity overview (assignment-backed, legacy)",
    description:
        "Legacy multi-surveyor assignment snapshot. Prefer survey-route-coverage and survey-work-history for the one-surveyor dashboard. Active only when session is active and heartbeat is fresh (2 minutes).",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            date: { type: "string", format: "date" },
            surveyorPublicId: { type: "string", format: "uuid" },
            workStatus: { type: "string", enum: ["not_started", "partial", "finished"] },
            routeSearch: { type: "string" },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: ["generatedAt", "heartbeatFreshWithinSeconds", "summary", "items"],
            properties: {
                generatedAt: { type: "string", format: "date-time" },
                heartbeatFreshWithinSeconds: { type: "integer" },
                summary: {
                    type: "object",
                    required: [
                        "activeNow",
                        "assigned",
                        "partial",
                        "finished",
                        "remaining",
                        "pendingSync",
                    ],
                    properties: {
                        activeNow: { type: "integer" },
                        assigned: { type: "integer" },
                        partial: { type: "integer" },
                        finished: { type: "integer" },
                        remaining: { type: "integer" },
                        pendingSync: { type: "integer" },
                    },
                    additionalProperties: false,
                },
                items: { type: "array", items: surveyActivityItemSchema },
            },
            additionalProperties: false,
        },
        ...surveySessionAuthErrors,
    },
};

const surveyorRefSchema = {
    type: "object",
    required: ["publicId", "displayName", "email"],
    properties: {
        publicId: { type: "string", format: "uuid" },
        displayName: { type: "string" },
        email: { type: "string" },
    },
    additionalProperties: false,
} as const;

const routeRefSchema = {
    type: "object",
    required: ["publicId", "code"],
    properties: {
        publicId: { type: "string", format: "uuid" },
        code: { type: "string" },
    },
    additionalProperties: false,
} as const;

const lastPositionSchema = {
    type: "object",
    nullable: true,
    required: ["lat", "lng", "accuracyM", "at"],
    properties: {
        lat: { type: "number" },
        lng: { type: "number" },
        accuracyM: { type: "number", nullable: true },
        at: { type: "string", format: "date-time", nullable: true },
    },
    additionalProperties: false,
} as const;

const surveyRouteCoverageItemSchema = {
    type: "object",
    required: [
        "route",
        "variantCode",
        "routeVariantPublicId",
        "workStatus",
        "remaining",
        "sessionStatus",
        "presenceStatus",
        "completionStatus",
        "sessionPublicId",
        "startedAt",
        "lastActivityAt",
        "lastSurveyedAt",
        "activeDurationSeconds",
        "lastCheckedStopSequence",
        "checkedStopCount",
        "totalStopCount",
        "checkedLabel",
        "latestSessionReportCount",
        "variantReportCount",
        "pendingSyncCount",
        "syncState",
    ],
    properties: {
        route: routeRefSchema,
        variantCode: { type: "string", enum: ["D0", "D1"] },
        routeVariantPublicId: { type: "string", format: "uuid" },
        workStatus: { type: "string", enum: ["not_started", "partial", "finished"] },
        remaining: { type: "boolean" },
        sessionStatus: {
            type: "string",
            enum: ["active", "completed", "abandoned", "none"],
        },
        presenceStatus: { type: "string", enum: ["live", "stale", "offline"] },
        completionStatus: {
            type: "string",
            enum: ["none", "finished", "not_finished"],
        },
        sessionPublicId: { type: "string", format: "uuid", nullable: true },
        startedAt: { type: "string", format: "date-time", nullable: true },
        lastActivityAt: { type: "string", format: "date-time", nullable: true },
        lastSurveyedAt: { type: "string", format: "date-time", nullable: true },
        activeDurationSeconds: { type: "integer" },
        lastCheckedStopSequence: { type: "integer", nullable: true },
        checkedStopCount: { type: "integer" },
        totalStopCount: { type: "integer" },
        checkedLabel: { type: "string" },
        latestSessionReportCount: { type: "integer" },
        variantReportCount: { type: "integer" },
        pendingSyncCount: { type: "integer" },
        syncState: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

export const getSurveyRouteCoverageSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Admin route coverage for the field surveyor",
    description:
        "All active YBS D0/D1 variants left-joined to the selected surveyor's latest session and current completion. No assignment rows. New active variants appear as not_started automatically.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            surveyorPublicId: { type: "string", format: "uuid" },
            workStatus: { type: "string", enum: ["not_started", "partial", "finished"] },
            routeSearch: { type: "string" },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: [
                "generatedAt",
                "heartbeatFreshWithinSeconds",
                "surveyor",
                "summary",
                "items",
            ],
            properties: {
                generatedAt: { type: "string", format: "date-time" },
                heartbeatFreshWithinSeconds: { type: "integer" },
                surveyor: surveyorRefSchema,
                summary: {
                    type: "object",
                    required: [
                        "totalActiveVariants",
                        "notStarted",
                        "partial",
                        "finished",
                        "remaining",
                        "activeNow",
                    ],
                    properties: {
                        totalActiveVariants: { type: "integer" },
                        notStarted: { type: "integer" },
                        partial: { type: "integer" },
                        finished: { type: "integer" },
                        remaining: { type: "integer" },
                        activeNow: { type: "integer" },
                    },
                    additionalProperties: false,
                },
                items: { type: "array", items: surveyRouteCoverageItemSchema },
            },
            additionalProperties: false,
        },
        ...surveySessionAuthErrors,
    },
};

const surveyWorkHistoryItemSchema = {
    type: "object",
    required: [
        "sessionPublicId",
        "clientSessionId",
        "route",
        "variantCode",
        "routeVariantPublicId",
        "sessionStatus",
        "presenceStatus",
        "currentCompletionStatus",
        "startedAt",
        "endedAt",
        "lastActivityAt",
        "activeDurationSeconds",
        "lastCheckedStopSequence",
        "checkedStopCount",
        "totalStopCount",
        "checkedLabel",
        "reportCount",
        "reportCountLabel",
        "isShortEmptySession",
        "pendingSyncCount",
        "syncState",
        "lastPosition",
    ],
    properties: {
        sessionPublicId: { type: "string", format: "uuid" },
        clientSessionId: { type: "string", format: "uuid" },
        route: routeRefSchema,
        variantCode: { type: "string", enum: ["D0", "D1"] },
        routeVariantPublicId: { type: "string", format: "uuid" },
        sessionStatus: {
            type: "string",
            enum: ["active", "completed", "abandoned", "none"],
        },
        presenceStatus: { type: "string", enum: ["live", "stale", "offline"] },
        currentCompletionStatus: {
            type: "string",
            enum: ["none", "finished", "not_finished"],
        },
        startedAt: { type: "string", format: "date-time" },
        endedAt: { type: "string", format: "date-time", nullable: true },
        lastActivityAt: { type: "string", format: "date-time", nullable: true },
        activeDurationSeconds: { type: "integer" },
        lastCheckedStopSequence: { type: "integer", nullable: true },
        checkedStopCount: { type: "integer" },
        totalStopCount: { type: "integer" },
        checkedLabel: { type: "string" },
        reportCount: { type: "integer" },
        reportCountLabel: { type: "string" },
        isShortEmptySession: { type: "boolean" },
        pendingSyncCount: { type: "integer" },
        syncState: { type: "string", nullable: true },
        lastPosition: lastPositionSchema,
    },
    additionalProperties: false,
} as const;

export const getSurveyWorkHistorySchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Admin surveyor work history",
    description:
        "Paginated survey sessions for the selected surveyor. Does not join assignments. Default range is the last 30 days inclusive. Short empty completed sessions are hidden by default. Report counts use DISTINCT pre-aggregation.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            surveyorPublicId: { type: "string", format: "uuid" },
            routeSearch: { type: "string" },
            sessionStatus: { type: "string", enum: ["active", "completed", "abandoned"] },
            from: { type: "string", format: "date" },
            to: { type: "string", format: "date" },
            page: { type: "integer", minimum: 1, default: 1 },
            pageSize: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            includeShortSessions: { type: "boolean", default: false },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: [
                "generatedAt",
                "heartbeatFreshWithinSeconds",
                "surveyor",
                "range",
                "page",
                "pageSize",
                "total",
                "shortEmptySessionCount",
                "includeShortSessions",
                "items",
            ],
            properties: {
                generatedAt: { type: "string", format: "date-time" },
                heartbeatFreshWithinSeconds: { type: "integer" },
                surveyor: surveyorRefSchema,
                range: {
                    type: "object",
                    required: ["from", "to"],
                    properties: {
                        from: { type: "string", format: "date" },
                        to: { type: "string", format: "date" },
                    },
                    additionalProperties: false,
                },
                page: { type: "integer" },
                pageSize: { type: "integer" },
                total: { type: "integer" },
                shortEmptySessionCount: { type: "integer" },
                includeShortSessions: { type: "boolean" },
                items: { type: "array", items: surveyWorkHistoryItemSchema },
            },
            additionalProperties: false,
        },
        ...surveySessionAuthErrors,
    },
};

export const getSurveySessionTimelineSchema: FastifySchema = {
    tags: [Tags.Field],
    summary: "Admin survey session timeline",
    description:
        "Session detail plus append-only START/STOP/FINISH/REOPEN events. Report count is aggregated. Administrator only.",
    security: [...bearerAuth],
    params: surveySessionPublicIdParams,
    response: {
        200: {
            type: "object",
            required: ["generatedAt", "heartbeatFreshWithinSeconds", "session", "events"],
            properties: {
                generatedAt: { type: "string", format: "date-time" },
                heartbeatFreshWithinSeconds: { type: "integer" },
                session: {
                    type: "object",
                    required: [
                        "publicId",
                        "clientSessionId",
                        "surveyor",
                        "route",
                        "variantCode",
                        "routeVariantPublicId",
                        "sessionStatus",
                        "presenceStatus",
                        "currentCompletionStatus",
                        "startedAt",
                        "endedAt",
                        "lastActivityAt",
                        "activeDurationSeconds",
                        "checkedStopCount",
                        "totalStopCount",
                        "reportCount",
                        "pendingSyncCount",
                        "syncState",
                        "lastPosition",
                    ],
                    properties: {
                        publicId: { type: "string", format: "uuid" },
                        clientSessionId: { type: "string", format: "uuid" },
                        surveyor: surveyorRefSchema,
                        route: routeRefSchema,
                        variantCode: { type: "string", enum: ["D0", "D1"] },
                        routeVariantPublicId: { type: "string", format: "uuid" },
                        sessionStatus: {
                            type: "string",
                            enum: ["active", "completed", "abandoned", "none"],
                        },
                        presenceStatus: {
                            type: "string",
                            enum: ["live", "stale", "offline"],
                        },
                        currentCompletionStatus: {
                            type: "string",
                            enum: ["none", "finished", "not_finished"],
                        },
                        startedAt: { type: "string", format: "date-time" },
                        endedAt: { type: "string", format: "date-time", nullable: true },
                        lastActivityAt: {
                            type: "string",
                            format: "date-time",
                            nullable: true,
                        },
                        activeDurationSeconds: { type: "integer" },
                        checkedStopCount: { type: "integer" },
                        totalStopCount: { type: "integer" },
                        reportCount: { type: "integer" },
                        pendingSyncCount: { type: "integer" },
                        syncState: { type: "string", nullable: true },
                        lastPosition: lastPositionSchema,
                    },
                    additionalProperties: false,
                },
                events: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["eventType", "occurredAt", "clientEventId"],
                        properties: {
                            eventType: { type: "string" },
                            occurredAt: { type: "string", format: "date-time" },
                            clientEventId: {
                                type: "string",
                                format: "uuid",
                                nullable: true,
                            },
                        },
                        additionalProperties: false,
                    },
                },
            },
            additionalProperties: false,
        },
        ...surveySessionAuthErrors,
    },
};

