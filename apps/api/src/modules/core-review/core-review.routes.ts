import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import {
    coreReviewEntityIdParamSchema,
    coreReviewEntityParamSchema,
    coreReviewListQuerySchema,
    settlementDuplicateWarningQuerySchema,
} from "./core-review.schema.js";
import { CoreReviewService } from "./core-review.service.js";
import { getCoreReviewEntityByPath } from "./core-review.entity-registry.js";
import {
    getCoreReviewDetailSchema,
    getCoreReviewListSchema,
    getCoreReviewStreetsCountSchema,
    postCoreReviewEntitySchema,
    postCoreReviewLandAreaPromoteSchema,
    postCoreReviewLandAreaDemoteSchema,
    postCoreReviewLandAreaDeleteSchema,
    postCoreReviewLandAreaClearSuppressionSchema,
    patchCoreReviewEntitySchema,
    patchCoreReviewSoftDeleteSchema,
    patchCoreReviewRestoreSchema,
} from "./core-review.openapi.js";
import {
    getCoreReviewCreateSchema,
    getCoreReviewPatchSchema,
    sanitizeCoreReviewWriteBody,
    normalizeWriteBodyAliases,
} from "./core-review-write.schema.js";
import {
    CoreReviewDemoteBlockedError,
    CoreReviewLifecycleNotSupportedError,
    CoreReviewNotFoundError,
    CoreReviewSuppressedError,
    CoreReviewValidationError,
} from "./core-review-write.errors.js";
import {
    clearLandAreaRenderSuppressionBodySchema,
    deleteOsmLandAreaBodySchema,
    demoteOsmLandAreaBodySchema,
    promoteOsmLandAreaBodySchema,
} from "./entities/land-areas-promote.schema.js";
import { mapDatabaseWriteError, sanitizeDevWriteErrorMessage } from "./core-review-write.helpers.js";
import { CORE_REVIEW_VERIFICATION_SUMMARY_CONFIGS } from "./core-review-verification-summary.config.js";
import { buildVerificationSummary } from "../../lib/verification-summary/verification-summary.repo.js";
import { replyCoreReviewReadError } from "./core-review-read.errors.js";

function replyCoreReviewValidationError(reply: FastifyReply, error: CoreReviewValidationError) {
    return reply.code(400).send({
        message: error.message,
        issues: error.issues,
        ...(error.code ? { code: error.code } : {}),
    });
}

function replyCoreReviewWriteError(
    request: FastifyRequest,
    reply: FastifyReply,
    error: unknown,
    context: string,
    meta?: { entity?: string; operation?: string; payloadKeys?: string[] },
) {
    const mapped = mapDatabaseWriteError(error);
    if (mapped) {
        request.log.info(
            {
                entity: meta?.entity,
                operation: meta?.operation,
                payloadKeys: meta?.payloadKeys,
                validationIssues: mapped.issues,
            },
            `${context} (mapped validation)`,
        );
        return reply.code(400).send({ message: mapped.message, issues: mapped.issues });
    }

    request.log.error(
        {
            err: error,
            entity: meta?.entity,
            operation: meta?.operation,
            payloadKeys: meta?.payloadKeys,
        },
        context,
    );

    const isDev = process.env.NODE_ENV !== "production";
    const devDetail =
        isDev && error instanceof Error ? sanitizeDevWriteErrorMessage(error.message) : undefined;

    return reply.code(500).send({
        message: devDetail
            ? `Save failed: ${devDetail}`
            : "We could not save that core review change. Please try again.",
    });
}

async function handleCoreReviewLifecycle(
    request: FastifyRequest,
    reply: FastifyReply,
    service: CoreReviewService,
    operation: "soft-delete" | "restore",
) {
    const paramsParsed = coreReviewEntityIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
        return reply.code(400).send({
            message: "Invalid path parameters",
            issues: paramsParsed.error.flatten(),
        });
    }

    const def = getCoreReviewEntityByPath(paramsParsed.data.entity);
    if (!def) {
        return reply.code(404).send({ message: "Unknown core-review entity" });
    }

    try {
        const result =
            operation === "soft-delete"
                ? await service.softDelete(def.path, paramsParsed.data.id, request.user)
                : await service.restore(def.path, paramsParsed.data.id, request.user);

        request.log.info(
            { entity: def.slug, operation, id: paramsParsed.data.id },
            `core-review ${operation}`,
        );
        return reply.send(result);
    } catch (error) {
        if (error instanceof CoreReviewNotFoundError) {
            return reply.code(404).send({ message: error.message });
        }
        if (error instanceof CoreReviewLifecycleNotSupportedError) {
            return reply.code(400).send({ message: error.message });
        }
        if (error instanceof CoreReviewValidationError) {
            request.log.info(
                {
                    entity: def.slug,
                    operation,
                    id: paramsParsed.data.id,
                    validationIssues: error.issues,
                },
                `core-review ${operation} rejected`,
            );
            return replyCoreReviewValidationError(reply, error);
        }
        return replyCoreReviewWriteError(
            request,
            reply,
            error,
            `core-review ${operation} failed`,
        );
    }
}

const coreReviewRoutes: FastifyPluginAsync = async (app) => {
    const service = new CoreReviewService(app.prisma);

    app.get(
        "/verification-summary",
        { preHandler: [app.authenticate, app.requireDashboardAccess] },
        async (_request, reply) => {
            try {
                return reply.send(
                    await buildVerificationSummary(app.prisma, CORE_REVIEW_VERIFICATION_SUMMARY_CONFIGS)
                );
            } catch (error) {
                return replyCoreReviewReadError(_request, reply, error, "core-review verification summary failed");
            }
        }
    );

    app.get(
        "/:entity",
        {
            preHandler: [app.authenticate, app.requireDashboardAccess],
            schema: getCoreReviewListSchema,
        },
        async (request, reply) => {
            const paramsParsed = coreReviewEntityParamSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid entity path",
                    issues: paramsParsed.error.flatten(),
                });
            }

            const def = getCoreReviewEntityByPath(paramsParsed.data.entity);
            if (!def) {
                return reply.code(404).send({ message: "Unknown core-review entity" });
            }

            const queryParsed = coreReviewListQuerySchema.safeParse(request.query);
            if (!queryParsed.success) {
                return reply.code(400).send({
                    message: "Invalid list query",
                    issues: queryParsed.error.flatten(),
                });
            }

            try {
                const result = await service.list(def.path, queryParsed.data);
                if (!result) {
                    return reply.code(404).send({ message: "Unknown core-review entity" });
                }

                request.log.info(
                    {
                        entity: def.slug,
                        page: queryParsed.data.page,
                        pageSize: queryParsed.data.pageSize,
                        total: result.pagination.total,
                        filters: result.filters,
                    },
                    "core-review list"
                );

                return reply.send(result);
            } catch (error) {
                return replyCoreReviewReadError(request, reply, error, "core-review list failed", {
                    entity: def.slug,
                    page: queryParsed.data.page,
                    pageSize: queryParsed.data.pageSize,
                });
            }
        }
    );

    app.get(
        "/:entity/count",
        {
            preHandler: [app.authenticate, app.requireDashboardAccess],
            schema: getCoreReviewStreetsCountSchema,
        },
        async (request, reply) => {
            const paramsParsed = coreReviewEntityParamSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid entity path",
                    issues: paramsParsed.error.flatten(),
                });
            }

            const def = getCoreReviewEntityByPath(paramsParsed.data.entity);
            if (!def || def.slug !== "streets") {
                return reply.code(404).send({ message: "Count endpoint not available for this entity" });
            }

            const queryParsed = coreReviewListQuerySchema.safeParse(request.query);
            if (!queryParsed.success) {
                return reply.code(400).send({
                    message: "Invalid count query",
                    issues: queryParsed.error.flatten(),
                });
            }

            try {
                const result = await service.count(def.path, queryParsed.data);
                if (!result) {
                    return reply.code(404).send({ message: "Count endpoint not available for this entity" });
                }

                request.log.info(
                    {
                        entity: def.slug,
                        total: result.total,
                        filters: result.filters,
                    },
                    "core-review streets count",
                );

                return reply.send(result);
            } catch (error) {
                return replyCoreReviewReadError(request, reply, error, "core-review streets count failed", {
                    entity: def.slug,
                });
            }
        },
    );

    app.get(
        "/:entity/duplicate-warnings",
        {
            preHandler: [app.authenticate, app.requireDashboardAccess],
        },
        async (request, reply) => {
            const paramsParsed = coreReviewEntityParamSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid entity path",
                    issues: paramsParsed.error.flatten(),
                });
            }

            const def = getCoreReviewEntityByPath(paramsParsed.data.entity);
            if (!def || def.slug !== "settlements") {
                return reply.code(404).send({
                    message: "Duplicate warnings are not available for this entity",
                });
            }

            const queryParsed = settlementDuplicateWarningQuerySchema.safeParse(request.query);
            if (!queryParsed.success) {
                return reply.code(400).send({
                    message: "Invalid duplicate-warning query",
                    issues: queryParsed.error.flatten(),
                });
            }

            try {
                const result = await service.duplicateWarnings(def.path, {
                    canonicalName: queryParsed.data.canonicalName,
                    nameMm: queryParsed.data.nameMm,
                    nameEn: queryParsed.data.nameEn,
                    lat: queryParsed.data.lat,
                    lng: queryParsed.data.lng,
                    townshipId: queryParsed.data.townshipId
                        ? BigInt(queryParsed.data.townshipId)
                        : undefined,
                    excludePublicId: queryParsed.data.excludePublicId,
                });
                if (!result) {
                    return reply.code(404).send({
                        message: "Duplicate warnings are not available for this entity",
                    });
                }

                request.log.info(
                    { entity: def.slug, count: result.data.length },
                    "core-review settlement duplicate warnings",
                );

                return reply.send(result);
            } catch (error) {
                return replyCoreReviewReadError(
                    request,
                    reply,
                    error,
                    "core-review duplicate warnings failed",
                    { entity: def.slug },
                );
            }
        },
    );

    app.get(
        "/:entity/:id",
        {
            preHandler: [app.authenticate, app.requireDashboardAccess],
            schema: getCoreReviewDetailSchema,
        },
        async (request, reply) => {
            const paramsParsed = coreReviewEntityIdParamSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }

            const def = getCoreReviewEntityByPath(paramsParsed.data.entity);
            if (!def) {
                return reply.code(404).send({ message: "Unknown core-review entity" });
            }

            try {
                const result = await service.getDetail(def.path, paramsParsed.data.id);
                if (!result) {
                    return reply.code(404).send({ message: "Record not found" });
                }

                request.log.info(
                    { entity: def.slug, id: paramsParsed.data.id },
                    "core-review detail"
                );

                return reply.send(result);
            } catch (error) {
                return replyCoreReviewReadError(request, reply, error, "core-review detail failed", {
                    entity: def.slug,
                    id: paramsParsed.data.id,
                });
            }
        }
    );

    app.post(
        "/land-areas/promote-from-source",
        {
            preHandler: [app.authenticate, app.requireDashboardWrite],
            schema: postCoreReviewLandAreaPromoteSchema,
        },
        async (request, reply) => {
            const parsed = promoteOsmLandAreaBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid land area promote payload",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const promoted = await service.promoteLandAreaFromSource(parsed.data);
                const status = promoted.operation === "created" ? 201 : 200;
                return reply.code(status).send(promoted);
            } catch (error) {
                if (error instanceof CoreReviewValidationError) {
                    request.log.info(
                        { entity: "land-areas", operation: "promote-from-source", validationIssues: error.issues },
                        "core-review land-areas promote rejected",
                    );
                    return replyCoreReviewValidationError(reply, error);
                }
                if (error instanceof CoreReviewSuppressedError) {
                    return reply.code(409).send({ message: error.message });
                }
                return replyCoreReviewWriteError(
                    request,
                    reply,
                    error,
                    "core-review land-areas promote-from-source failed",
                    { entity: "land-areas", operation: "promote-from-source" },
                );
            }
        },
    );

    app.post(
        "/land-areas/demote-preflight",
        {
            preHandler: [app.authenticate, app.requireDashboardWrite],
            schema: postCoreReviewLandAreaDemoteSchema,
        },
        async (request, reply) => {
            const parsed = demoteOsmLandAreaBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid land area demote payload",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const prepared = await service.preflightDemoteLandAreaFromCore(parsed.data);
                return reply.send({
                    allowed: true,
                    feature_key: prepared.feature_key,
                    core_id: prepared.core_id,
                    public_id: prepared.public_id,
                    class_code: prepared.class_code,
                    name: prepared.name,
                    name_mm: prepared.name_mm,
                    name_en: prepared.name_en,
                    geometry: prepared.geometry,
                    core_snapshot: prepared.core_snapshot,
                });
            } catch (error) {
                if (error instanceof CoreReviewValidationError) {
                    return replyCoreReviewValidationError(reply, error);
                }
                if (error instanceof CoreReviewNotFoundError) {
                    return reply.code(404).send({ message: error.message });
                }
                if (error instanceof CoreReviewDemoteBlockedError) {
                    return reply.code(409).send({
                        allowed: false,
                        message: error.message,
                        dependencies: error.dependencies,
                    });
                }
                return replyCoreReviewWriteError(
                    request,
                    reply,
                    error,
                    "core-review land-areas demote-preflight failed",
                    { entity: "land-areas", operation: "demote-preflight" },
                );
            }
        },
    );

    app.post(
        "/land-areas/demote-from-core",
        {
            preHandler: [app.authenticate, app.requireDashboardWrite],
            schema: postCoreReviewLandAreaDemoteSchema,
        },
        async (request, reply) => {
            const parsed = demoteOsmLandAreaBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid land area demote payload",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const removed = await service.removeDemotedLandAreaFromCore(parsed.data, request.user);
                return reply.send(removed);
            } catch (error) {
                if (error instanceof CoreReviewValidationError) {
                    return replyCoreReviewValidationError(reply, error);
                }
                if (error instanceof CoreReviewNotFoundError) {
                    return reply.code(404).send({ message: error.message });
                }
                if (error instanceof CoreReviewDemoteBlockedError) {
                    return reply.code(409).send({
                        allowed: false,
                        message: error.message,
                        dependencies: error.dependencies,
                    });
                }
                return replyCoreReviewWriteError(
                    request,
                    reply,
                    error,
                    "core-review land-areas demote-from-core failed",
                    { entity: "land-areas", operation: "demote-from-core" },
                );
            }
        },
    );

    app.post(
        "/land-areas/delete-from-source",
        {
            preHandler: [app.authenticate, app.requireDashboardWrite],
            schema: postCoreReviewLandAreaDeleteSchema,
        },
        async (request, reply) => {
            const parsed = deleteOsmLandAreaBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid land area delete payload. confirm must be DELETE.",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                const result = await service.deleteLandAreaFromSource(parsed.data, request.user);
                return reply.send(result);
            } catch (error) {
                if (error instanceof CoreReviewValidationError) {
                    return replyCoreReviewValidationError(reply, error);
                }
                if (error instanceof CoreReviewDemoteBlockedError) {
                    return reply.code(409).send({
                        allowed: false,
                        message: error.message,
                        dependencies: error.dependencies,
                    });
                }
                return replyCoreReviewWriteError(
                    request,
                    reply,
                    error,
                    "core-review land-areas delete-from-source failed",
                    { entity: "land-areas", operation: "delete-from-source" },
                );
            }
        },
    );

    app.post(
        "/land-areas/clear-render-suppression",
        {
            preHandler: [app.authenticate, app.requireDashboardWrite],
            schema: postCoreReviewLandAreaClearSuppressionSchema,
        },
        async (request, reply) => {
            const parsed = clearLandAreaRenderSuppressionBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid clear-suppression payload. confirm must be CLEAR_SUPPRESSION.",
                    issues: parsed.error.flatten(),
                });
            }

            try {
                return reply.send(await service.clearLandAreaRenderSuppression(parsed.data));
            } catch (error) {
                if (error instanceof CoreReviewValidationError) {
                    return replyCoreReviewValidationError(reply, error);
                }
                return replyCoreReviewWriteError(
                    request,
                    reply,
                    error,
                    "core-review land-areas clear-render-suppression failed",
                    { entity: "land-areas", operation: "clear-render-suppression" },
                );
            }
        },
    );

    app.post(
        "/:entity",
        {
            preHandler: [app.authenticate, app.requireDashboardWrite],
            schema: postCoreReviewEntitySchema,
        },
        async (request, reply) => {
            const paramsParsed = coreReviewEntityParamSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid entity path",
                    issues: paramsParsed.error.flatten(),
                });
            }

            const def = getCoreReviewEntityByPath(paramsParsed.data.entity);
            if (!def) {
                return reply.code(404).send({ message: "Unknown core-review entity" });
            }

            const sanitized = sanitizeCoreReviewWriteBody(normalizeWriteBodyAliases(request.body));
            const schema = getCoreReviewCreateSchema(def.slug);
            const bodyParsed = schema.safeParse(sanitized);
            if (!bodyParsed.success) {
                request.log.info(
                    { entity: def.slug, operation: "create", validationIssues: bodyParsed.error.flatten() },
                    "core-review create validation failed",
                );
                return reply.code(400).send({
                    message: "Invalid payload",
                    issues: bodyParsed.error.flatten(),
                });
            }

            const payloadKeys = Object.keys(bodyParsed.data as Record<string, unknown>);

            try {
                const result = await service.create(
                    def.path,
                    bodyParsed.data as Record<string, unknown>,
                    request.user,
                    request.log,
                );
                if (!result) {
                    return reply.code(404).send({ message: "Unknown core-review entity" });
                }

                request.log.info(
                    { entity: def.slug, operation: "create", payloadKeys },
                    "core-review create",
                );
                return reply.code(201).send(result);
            } catch (error) {
                if (error instanceof CoreReviewValidationError) {
                    request.log.info(
                        {
                            entity: def.slug,
                            operation: "create",
                            payloadKeys,
                            validationIssues: error.issues,
                        },
                        "core-review create rejected",
                    );
                    return replyCoreReviewValidationError(reply, error);
                }
                return replyCoreReviewWriteError(request, reply, error, "core-review create failed", {
                    entity: def.slug,
                    operation: "create",
                    payloadKeys,
                });
            }
        },
    );

    app.patch(
        "/:entity/:id",
        {
            preHandler: [app.authenticate, app.requireDashboardWrite],
            schema: patchCoreReviewEntitySchema,
        },
        async (request, reply) => {
            const paramsParsed = coreReviewEntityIdParamSchema.safeParse(request.params);
            if (!paramsParsed.success) {
                return reply.code(400).send({
                    message: "Invalid path parameters",
                    issues: paramsParsed.error.flatten(),
                });
            }

            const def = getCoreReviewEntityByPath(paramsParsed.data.entity);
            if (!def) {
                return reply.code(404).send({ message: "Unknown core-review entity" });
            }

            const sanitized = sanitizeCoreReviewWriteBody(normalizeWriteBodyAliases(request.body));
            const schema = getCoreReviewPatchSchema(def.slug);
            const bodyParsed = schema.safeParse(sanitized);
            if (!bodyParsed.success) {
                request.log.info(
                    {
                        entity: def.slug,
                        operation: "update",
                        id: paramsParsed.data.id,
                        validationIssues: bodyParsed.error.flatten(),
                    },
                    "core-review update validation failed",
                );
                return reply.code(400).send({
                    message: "Invalid payload",
                    issues: bodyParsed.error.flatten(),
                });
            }

            try {
                const result = await service.update(
                    def.path,
                    paramsParsed.data.id,
                    bodyParsed.data as Record<string, unknown>,
                    request.user,
                    request.log,
                );
                if (result === null) {
                    return reply.code(404).send({ message: "Record not found" });
                }

                request.log.info(
                    { entity: def.slug, operation: "update", id: paramsParsed.data.id },
                    "core-review update",
                );
                return reply.send(result);
            } catch (error) {
                if (error instanceof CoreReviewNotFoundError) {
                    return reply.code(404).send({ message: error.message });
                }
                if (error instanceof CoreReviewValidationError) {
                    request.log.info(
                        {
                            entity: def.slug,
                            operation: "update",
                            id: paramsParsed.data.id,
                            validationIssues: error.issues,
                        },
                        "core-review update rejected",
                    );
                    return replyCoreReviewValidationError(reply, error);
                }
                return replyCoreReviewWriteError(request, reply, error, "core-review update failed", {
                    entity: def.slug,
                    operation: "update",
                    payloadKeys: Object.keys(bodyParsed.data as Record<string, unknown>),
                });
            }
        },
    );

    app.patch(
        "/:entity/:id/soft-delete",
        {
            preHandler: [app.authenticate, app.requireDashboardWrite],
            schema: patchCoreReviewSoftDeleteSchema,
        },
        async (request, reply) => handleCoreReviewLifecycle(request, reply, service, "soft-delete"),
    );

    app.patch(
        "/:entity/:id/restore",
        {
            preHandler: [app.authenticate, app.requireDashboardWrite],
            schema: patchCoreReviewRestoreSchema,
        },
        async (request, reply) => handleCoreReviewLifecycle(request, reply, service, "restore"),
    );
};

export default coreReviewRoutes;
