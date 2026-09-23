import type { FastifyPluginAsync } from "fastify";

import { PostalCodesRepository } from "../addresses/postal-codes.repo.js";
import {
    adminAreaChildrenQuerySchema,
    adminAreaDetailQuerySchema,
    adminAreaGeometryPatchBodySchema,
    adminAreaIdParamsSchema,
    adminAreaPostalCodesQuerySchema,
    adminAreaPublicIdParamsSchema,
    adminAreaRemediationPatchBodySchema,
    adminAreaValidateGeometryBodySchema,
    adminAreasListQuerySchema,
    adminAreasTileParamsSchema,
    adminAreasTileQuerySchema,
    postalCodesSearchQuerySchema,
    resolveGeometrySource,
} from "./admin-areas.geography.schema.js";
import { AdminAreasGeographyRepository } from "./admin-areas.geography.repo.js";
import {
    AdminAreaGeometryConflictError,
    AdminAreaGeometryValidationError,
    AdminAreaNotFoundError,
    AdminAreasGeographyService,
} from "./admin-areas.geography.service.js";
import {
    getAdminAreaByIdSchema,
    getAdminAreaChildrenSchema,
    getAdminAreaContextSchema,
    getAdminAreaOptionsSchema,
    getAdminAreaPostalCodesSchema,
    getAdminAreasSchema,
    getAdminAreasSummarySchema,
    getAdminAreasTileSchema,
    getPostalCodesSearchSchema,
    getRoadTownshipAdminAreaOptionsSchema,
    patchAdminAreaGeometrySchema,
    postAdminAreaValidateGeometrySchema,
} from "./admin-areas.openapi.js";
import {
    adminAreaOptionsQuerySchema,
    roadTownshipAdminAreaOptionsQuerySchema,
} from "./admin-areas.schema.js";
import { AdminAreasRepository } from "./admin-areas.repo.js";
import { AdminAreasService } from "./admin-areas.service.js";
import { isValidAdminAreaTileCoord } from "./admin-areas.mvt.js";

const adminAreasRoutes: FastifyPluginAsync = async (app) => {
    const adminAreasRepo = new AdminAreasRepository(app.prisma);
    const adminAreasService = new AdminAreasService(adminAreasRepo);
    const geographyRepo = new AdminAreasGeographyRepository(app.prisma);
    const postalRepo = new PostalCodesRepository(app.prisma);
    const geographyService = new AdminAreasGeographyService(geographyRepo, postalRepo);

    const dashboardRead = [app.authenticate, app.requireDashboardAccess] as const;
    const dashboardWrite = [app.authenticate, app.requireDashboardWrite] as const;

    app.get(
        "/admin-areas",
        {
            preHandler: [...dashboardRead],
            schema: getAdminAreasSchema,
        },
        async (request, reply) => {
            const parsed = adminAreasListQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid admin areas query",
                    issues: parsed.error.flatten(),
                });
            }
            const result = await geographyService.list(parsed.data);
            return reply.send(result);
        }
    );

    app.get(
        "/admin-areas/summary",
        {
            preHandler: [...dashboardRead],
            schema: getAdminAreasSummarySchema,
        },
        async (_request, reply) => {
            const summary = await geographyService.getSummary();
            return reply.send(summary);
        }
    );

    app.get(
        "/admin-areas/options",
        {
            preHandler: [...dashboardRead],
            schema: getAdminAreaOptionsSchema,
        },
        async (request, reply) => {
            const parsed = adminAreaOptionsQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid admin area options query",
                    issues: parsed.error.flatten(),
                });
            }
            const options = await adminAreasService.listAdminAreaOptions({
                limit: parsed.data.limit,
                q: parsed.data.q,
                adminLevelCode: parsed.data.admin_level_code,
                regionAdminAreaId: parsed.data.region_admin_area_id,
            });
            return reply.send(options);
        }
    );

    app.get(
        "/admin-areas/road-township-options",
        {
            preHandler: [...dashboardRead],
            schema: getRoadTownshipAdminAreaOptionsSchema,
        },
        async (request, reply) => {
            const parsed = roadTownshipAdminAreaOptionsQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid road township options query",
                    issues: parsed.error.flatten(),
                });
            }
            const options = await adminAreasService.searchRoadTownshipAdminAreaOptions({
                q: parsed.data.q,
                limit: parsed.data.limit,
            });
            return reply.send(options);
        }
    );

    app.get(
        "/admin-areas/tiles/:z/:x/:y",
        {
            preHandler: [...dashboardRead],
            schema: getAdminAreasTileSchema,
        },
        async (request, reply) => {
            const params = adminAreasTileParamsSchema.safeParse(request.params);
            const query = adminAreasTileQuerySchema.safeParse(request.query);
            if (!params.success || !query.success) {
                return reply.code(400).send({
                    message: "Invalid admin area tile request",
                    issues: {
                        params: params.success ? undefined : params.error.flatten(),
                        query: query.success ? undefined : query.error.flatten(),
                    },
                });
            }
            const { z, x, y } = params.data;
            if (!isValidAdminAreaTileCoord(z, x, y)) {
                return reply.code(400).send({ message: "Tile coordinates out of range" });
            }

            const tile = await geographyService.getTile(z, x, y, {
                level: query.data.level,
                type: query.data.type,
                status: query.data.status,
                geometrySource: resolveGeometrySource(query.data),
                official: query.data.official,
                isPublic: query.data.public,
            });

            reply.header("Content-Type", "application/vnd.mapbox-vector-tile");
            reply.header("Cache-Control", "private, max-age=60");
            return reply.send(tile);
        }
    );

    app.get(
        "/admin-areas/:id",
        {
            preHandler: [...dashboardRead],
            schema: getAdminAreaByIdSchema,
        },
        async (request, reply) => {
            const params = adminAreaIdParamsSchema.safeParse(request.params);
            const query = adminAreaDetailQuerySchema.safeParse(request.query);
            if (!params.success || !query.success) {
                return reply.code(400).send({
                    message: "Invalid admin area detail request",
                    issues: {
                        params: params.success ? undefined : params.error.flatten(),
                        query: query.success ? undefined : query.error.flatten(),
                    },
                });
            }

            try {
                const detail = await geographyService.getById(
                    params.data.id,
                    query.data.include_geometry === true
                );
                return reply.send(detail);
            } catch (error) {
                if (error instanceof AdminAreaNotFoundError) {
                    return reply.code(404).send({ message: "Admin area not found" });
                }
                throw error;
            }
        }
    );

    app.get(
        "/admin-areas/:publicId/context",
        {
            preHandler: [...dashboardRead],
            schema: getAdminAreaContextSchema,
        },
        async (request, reply) => {
            const params = adminAreaPublicIdParamsSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid admin area context request",
                    issues: params.error.flatten(),
                });
            }

            try {
                const context = await geographyService.getBoundaryContext(params.data.publicId);
                return reply.send(context);
            } catch (error) {
                if (error instanceof AdminAreaNotFoundError) {
                    return reply.code(404).send({ message: "Admin area not found" });
                }
                throw error;
            }
        }
    );

    app.post(
        "/admin-areas/:publicId/validate-geometry",
        {
            preHandler: [...dashboardRead],
            schema: postAdminAreaValidateGeometrySchema,
        },
        async (request, reply) => {
            const params = adminAreaPublicIdParamsSchema.safeParse(request.params);
            const body = adminAreaValidateGeometryBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return reply.code(400).send({
                    message: "Invalid admin area validate-geometry request",
                    issues: {
                        params: params.success ? undefined : params.error.flatten(),
                        body: body.success ? undefined : body.error.flatten(),
                    },
                });
            }

            try {
                const result = await geographyService.validateDraftGeometry(
                    params.data.publicId,
                    body.data
                );
                return reply.send(result);
            } catch (error) {
                if (error instanceof AdminAreaNotFoundError) {
                    return reply.code(404).send({ message: "Admin area not found" });
                }
                if (error instanceof AdminAreaGeometryValidationError) {
                    return reply.code(400).send({
                        message: error.message,
                        issues: error.issues,
                    });
                }
                throw error;
            }
        }
    );

    app.get(
        "/admin-areas/:id/children",
        {
            preHandler: [...dashboardRead],
            schema: getAdminAreaChildrenSchema,
        },
        async (request, reply) => {
            const params = adminAreaIdParamsSchema.safeParse(request.params);
            const query = adminAreaChildrenQuerySchema.safeParse(request.query);
            if (!params.success || !query.success) {
                return reply.code(400).send({
                    message: "Invalid admin area children request",
                    issues: {
                        params: params.success ? undefined : params.error.flatten(),
                        query: query.success ? undefined : query.error.flatten(),
                    },
                });
            }

            try {
                const result = await geographyService.listChildren(params.data.id, query.data);
                return reply.send(result);
            } catch (error) {
                if (error instanceof AdminAreaNotFoundError) {
                    return reply.code(404).send({ message: "Admin area not found" });
                }
                throw error;
            }
        }
    );

    app.get(
        "/admin-areas/:id/postal-codes",
        {
            preHandler: [...dashboardRead],
            schema: getAdminAreaPostalCodesSchema,
        },
        async (request, reply) => {
            const params = adminAreaIdParamsSchema.safeParse(request.params);
            const query = adminAreaPostalCodesQuerySchema.safeParse(request.query);
            if (!params.success || !query.success) {
                return reply.code(400).send({
                    message: "Invalid admin area postal-codes request",
                    issues: {
                        params: params.success ? undefined : params.error.flatten(),
                        query: query.success ? undefined : query.error.flatten(),
                    },
                });
            }

            try {
                const result = await geographyService.listPostalCodesForAdminArea(
                    params.data.id,
                    query.data
                );
                return reply.send(result);
            } catch (error) {
                if (error instanceof AdminAreaNotFoundError) {
                    return reply.code(404).send({ message: "Admin area not found" });
                }
                throw error;
            }
        }
    );

    app.patch(
        "/admin-areas/:id/geometry",
        {
            preHandler: [...dashboardWrite],
            schema: patchAdminAreaGeometrySchema,
        },
        async (request, reply) => {
            const params = adminAreaIdParamsSchema.safeParse(request.params);
            const body = adminAreaGeometryPatchBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return reply.code(400).send({
                    message: "Invalid admin area geometry patch",
                    issues: {
                        params: params.success ? undefined : params.error.flatten(),
                        body: body.success ? undefined : body.error.flatten(),
                    },
                });
            }

            try {
                const result = await geographyService.updateGeometry(
                    params.data.id,
                    body.data,
                    request.user
                );
                return reply.send(result);
            } catch (error) {
                if (error instanceof AdminAreaNotFoundError) {
                    return reply.code(404).send({ message: "Admin area not found" });
                }
                if (error instanceof AdminAreaGeometryValidationError) {
                    return reply.code(400).send({
                        message: error.message,
                        issues: error.issues,
                    });
                }
                if (error instanceof AdminAreaGeometryConflictError) {
                    return reply.code(409).send({
                        code: "CONFLICT",
                        message: error.message,
                    });
                }
                throw error;
            }
        }
    );

    app.patch(
        "/admin-areas/:id/remediation",
        {
            preHandler: [...dashboardWrite],
        },
        async (request, reply) => {
            const params = adminAreaIdParamsSchema.safeParse(request.params);
            const body = adminAreaRemediationPatchBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return reply.code(400).send({
                    message: "Invalid admin area remediation patch",
                    issues: {
                        params: params.success ? undefined : params.error.flatten(),
                        body: body.success ? undefined : body.error.flatten(),
                    },
                });
            }

            try {
                const result = await geographyService.applyRemediation(
                    params.data.id,
                    body.data,
                    request.user
                );
                return reply.send(result);
            } catch (error) {
                if (error instanceof AdminAreaNotFoundError) {
                    return reply.code(404).send({ message: "Admin area not found" });
                }
                if (error instanceof AdminAreaGeometryValidationError) {
                    return reply.code(400).send({
                        message: error.message,
                        issues: error.issues,
                    });
                }
                if (error instanceof AdminAreaGeometryConflictError) {
                    return reply.code(409).send({
                        code: "CONFLICT",
                        message: error.message,
                    });
                }
                throw error;
            }
        }
    );

    app.get(
        "/postal-codes",
        {
            preHandler: [...dashboardRead],
            schema: getPostalCodesSearchSchema,
        },
        async (request, reply) => {
            const parsed = postalCodesSearchQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid postal codes query",
                    issues: parsed.error.flatten(),
                });
            }
            const result = await geographyService.searchPostalCodes(parsed.data);
            return reply.send(result);
        }
    );
};

export default adminAreasRoutes;
