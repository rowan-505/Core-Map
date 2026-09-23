import type { FastifyPluginAsync, FastifyReply } from "fastify";
import rateLimit from "@fastify/rate-limit";

import { TourismReviewsRepository } from "./tourism.repo.js";
import { TourismReviewsError, TourismReviewsService } from "./tourism.service.js";
import { TourismGeoRankingService } from "./tourism.geo-ranking.service.js";
import { TourismCatalogRepository } from "./tourism.catalog.repo.js";
import { TourismCatalogService } from "./tourism.catalog.service.js";
import { TourismVisitorRepository } from "./tourism.visitor.repo.js";
import { TourismVisitorService } from "./tourism.visitor.service.js";
import { TourismResearchRepository } from "./tourism.research.repo.js";
import { TourismResearchService } from "./tourism.research.service.js";
import {
    createTourismPlaceProfileBodySchema,
    ignoreTourismCandidateBodySchema,
    listAdminTourismCandidatesOverviewQuerySchema,
    listAdminTourismCandidatesQuerySchema,
    listAdminTourismPlaceSearchQuerySchema,
    listAdminTourismGeoRankingQuerySchema,
    listTourismGeoRankingQuerySchema,
    listTourismPlacesRankingQuerySchema,
    postAdminTourismRankingPreviewBodySchema,
    tourismPlaceIdParamSchema,
    tourismPlaceLangQuerySchema,
    updateTourismPlaceProfileBodySchema,
} from "./tourism.schema.js";
import {
    confirmTourismScheduleReviewBodySchema,
    createTourismActivityBodySchema,
    createTourismEventBodySchema,
    createTourismOccurrenceBodySchema,
    listAdminTourismActivitiesQuerySchema,
    listAdminTourismEventsQuerySchema,
    listPublicTourismActivitiesQuerySchema,
    listPublicTourismEventsQuerySchema,
    listTourismOccurrencesQuerySchema,
    tourismActivityIdParamSchema,
    tourismEventIdParamSchema,
    tourismEventOccurrenceIdParamSchema,
    tourismEventOccurrencesParamSchema,
    updateTourismActivityBodySchema,
    updateTourismEventBodySchema,
    updateTourismOccurrenceBodySchema,
} from "./tourism.catalog.schema.js";
import {
    createTourismAdvisoryBodySchema,
    createTourismFoodBodySchema,
    createTourismFoodPlaceLinkBodySchema,
    createTourismGuideBodySchema,
    listAdminTourismAdvisoriesQuerySchema,
    listAdminTourismFoodsQuerySchema,
    listAdminTourismGuidesQuerySchema,
    listPublicTourismAdvisoriesQuerySchema,
    listPublicTourismFoodsQuerySchema,
    listPublicTourismGuidesQuerySchema,
    tourismAdvisoryIdParamSchema,
    tourismFoodIdParamSchema,
    tourismFoodPlaceParamSchema,
    tourismFoodPlacesCreateParamSchema,
    tourismGuideIdParamSchema,
    updateTourismAdvisoryBodySchema,
    updateTourismFoodBodySchema,
    updateTourismFoodPlaceLinkBodySchema,
    updateTourismGuideBodySchema,
} from "./tourism.visitor.schema.js";
import {
    bulkImportTourismResearchBodySchema,
    listAdminTourismResearchQuerySchema,
    markTourismResearchAddedBodySchema,
    tourismResearchIdParamSchema,
    updateTourismResearchStatusBodySchema,
} from "./tourism.research.schema.js";
import {
    getTourismPlaceProfileSchema,
    getTourismPlacesRankingSchema,
    getTourismTypesSchema,
    patchAdminTourismPlaceProfileSchema,
    postAdminTourismPlaceProfileSchema,
} from "./tourism.openapi.js";

function handleTourismError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof TourismReviewsError) {
        return reply.code(error.statusCode).send({
            message: error.message,
            ...(error.code ? { code: error.code } : {}),
        });
    }
    throw error;
}

function auditFromRequest(request: {
    ip: string;
    headers: { "user-agent"?: string };
}) {
    return {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
    };
}

export type TourismRoutesOptions = {
    service?: TourismReviewsService;
    geoRankingService?: TourismGeoRankingService;
    catalogService?: TourismCatalogService;
    visitorService?: TourismVisitorService;
    researchService?: TourismResearchService;
};

/**
 * Tourism overlay HTTP surface: profiles + ranking + activities/events admin.
 * Universal place reviews live in modules/place-reviews.
 */
const tourismRoutes: FastifyPluginAsync<TourismRoutesOptions> = async (app, opts) => {
    const service =
        opts.service ?? new TourismReviewsService(new TourismReviewsRepository(app.prisma));
    const geoRanking =
        opts.geoRankingService ?? TourismGeoRankingService.create(app.prisma);
    const catalog =
        opts.catalogService ??
        new TourismCatalogService(new TourismCatalogRepository(app.prisma));
    const visitor =
        opts.visitorService ??
        new TourismVisitorService(new TourismVisitorRepository(app.prisma));
    const research =
        opts.researchService ??
        new TourismResearchService(new TourismResearchRepository(app.prisma));
    const adminGuard = {
        preHandler: [app.authenticate, app.requireRole("admin", "super_admin")],
    };

    app.get("/tourism/types", { schema: getTourismTypesSchema }, async (_request, reply) => {
        return reply.send({ items: await service.listTourismTypes() });
    });

    app.get("/tourism/places", { schema: getTourismPlacesRankingSchema }, async (request, reply) => {
        const query = listTourismPlacesRankingQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid tourism places ranking query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(await service.listRankedPlaces(query.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/tourism/ranking", async (request, reply) => {
        const query = listTourismGeoRankingQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid tourism geographic ranking query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(await geoRanking.listRanking(query.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/tourism/places/:placeId/geo-ranks", async (request, reply) => {
        const params = tourismPlaceIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ message: "Invalid tourism place id" });
        }
        try {
            return reply.send(await geoRanking.getPlaceGeoRanks(params.data.placeId));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get(
        "/tourism/places/:placeId",
        { schema: getTourismPlaceProfileSchema },
        async (request, reply) => {
            const params = tourismPlaceIdParamSchema.safeParse(request.params);
            const query = tourismPlaceLangQuerySchema.safeParse(request.query);
            if (!params.success || !query.success) {
                return reply.code(400).send({ message: "Invalid tourism place query" });
            }
            try {
                return reply.send(
                    await service.getPublicPlaceProfile(params.data.placeId, query.data.lang)
                );
            } catch (error) {
                return handleTourismError(error, reply);
            }
        }
    );

    app.get("/tourism/activities", async (request, reply) => {
        const query = listPublicTourismActivitiesQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid tourism activities query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(await catalog.listPublicActivities(query.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/tourism/events", async (request, reply) => {
        const query = listPublicTourismEventsQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid tourism events query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(await catalog.listPublicEvents(query.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/admin/tourism/ranking", { ...adminGuard }, async (request, reply) => {
        const query = listAdminTourismGeoRankingQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid admin tourism ranking query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(
                await geoRanking.listRanking({
                    ...query.data,
                    include_breakdown: true,
                })
            );
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.post("/admin/tourism/ranking/preview", { ...adminGuard }, async (request, reply) => {
        const body = postAdminTourismRankingPreviewBodySchema.safeParse(request.body);
        if (!body.success) {
            return reply.code(400).send({
                message: "Invalid tourism ranking preview body",
                issues: body.error.flatten(),
            });
        }
        try {
            return reply.send(await geoRanking.previewRanking(body.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/admin/tourism/candidates", { ...adminGuard }, async (request, reply) => {
        const query = listAdminTourismCandidatesQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid tourism candidates query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(await service.listTourismCandidates(query.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/admin/tourism/places/search", { ...adminGuard }, async (request, reply) => {
        const query = listAdminTourismPlaceSearchQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid tourism place search query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(await service.searchPlacesForPicker(query.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/admin/tourism/candidates/overview", { ...adminGuard }, async (request, reply) => {
        const query = listAdminTourismCandidatesOverviewQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid tourism candidates overview query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(await service.listTourismCandidatesOverview(query.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.post(
        "/admin/tourism/candidates/:placeId/approve",
        { ...adminGuard },
        async (request, reply) => {
            const params = tourismPlaceIdParamSchema.safeParse(request.params);
            const body = createTourismPlaceProfileBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return reply.code(400).send({ message: "Invalid tourism candidate approve payload" });
            }
            try {
                const created = await service.approveTourismCandidate(
                    request.user.sub,
                    params.data.placeId,
                    body.data,
                    {
                        ipAddress: request.ip,
                        userAgent: request.headers["user-agent"] ?? null,
                    }
                );
                return reply.code(201).send(created);
            } catch (error) {
                return handleTourismError(error, reply);
            }
        }
    );

    app.post(
        "/admin/tourism/candidates/:placeId/ignore",
        { ...adminGuard },
        async (request, reply) => {
            const params = tourismPlaceIdParamSchema.safeParse(request.params);
            const body = ignoreTourismCandidateBodySchema.safeParse(request.body ?? {});
            if (!params.success || !body.success) {
                return reply.code(400).send({ message: "Invalid tourism candidate ignore payload" });
            }
            try {
                return reply.send(
                    await service.ignoreTourismCandidate(
                        request.user.sub,
                        params.data.placeId,
                        body.data,
                        {
                            ipAddress: request.ip,
                            userAgent: request.headers["user-agent"] ?? null,
                        }
                    )
                );
            } catch (error) {
                return handleTourismError(error, reply);
            }
        }
    );

    app.get(
        "/admin/tourism/places/:placeId/profile",
        { ...adminGuard },
        async (request, reply) => {
            const params = tourismPlaceIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({ message: "Invalid tourism place id" });
            }
            try {
                return reply.send(await service.getAdminPlaceProfile(params.data.placeId));
            } catch (error) {
                return handleTourismError(error, reply);
            }
        }
    );

    app.post(
        "/admin/tourism/places/:placeId/profile",
        { ...adminGuard, schema: postAdminTourismPlaceProfileSchema },
        async (request, reply) => {
            const params = tourismPlaceIdParamSchema.safeParse(request.params);
            const body = createTourismPlaceProfileBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return reply.code(400).send({ message: "Invalid tourism profile payload" });
            }
            try {
                const created = await service.createPlaceProfile(
                    request.user.sub,
                    params.data.placeId,
                    body.data,
                    {
                        ipAddress: request.ip,
                        userAgent: request.headers["user-agent"] ?? null,
                    }
                );
                return reply.code(201).send(created);
            } catch (error) {
                return handleTourismError(error, reply);
            }
        }
    );

    app.patch(
        "/admin/tourism/places/:placeId/profile",
        { ...adminGuard, schema: patchAdminTourismPlaceProfileSchema },
        async (request, reply) => {
            const params = tourismPlaceIdParamSchema.safeParse(request.params);
            const body = updateTourismPlaceProfileBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return reply.code(400).send({ message: "Invalid tourism profile payload" });
            }
            try {
                return reply.send(
                    await service.updatePlaceProfile(
                        request.user.sub,
                        params.data.placeId,
                        body.data,
                        auditFromRequest(request)
                    )
                );
            } catch (error) {
                return handleTourismError(error, reply);
            }
        }
    );

    // --- Activities ---
    app.get("/admin/tourism/activity-types", { ...adminGuard }, async (_request, reply) => {
        return reply.send({ items: await catalog.listActivityTypes() });
    });

    app.get("/admin/tourism/activities", { ...adminGuard }, async (request, reply) => {
        const query = listAdminTourismActivitiesQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid tourism activities query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(await catalog.listActivities(query.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/admin/tourism/activities/:id", { ...adminGuard }, async (request, reply) => {
        const params = tourismActivityIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ message: "Invalid activity id" });
        }
        try {
            return reply.send(await catalog.getActivity(params.data.id));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.post("/admin/tourism/activities", { ...adminGuard }, async (request, reply) => {
        const body = createTourismActivityBodySchema.safeParse(request.body);
        if (!body.success) {
            return reply.code(400).send({
                message: "Invalid tourism activity payload",
                issues: body.error.flatten(),
            });
        }
        try {
            const created = await catalog.createActivity(
                request.user.sub,
                body.data,
                auditFromRequest(request)
            );
            return reply.code(201).send(created);
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.patch("/admin/tourism/activities/:id", { ...adminGuard }, async (request, reply) => {
        const params = tourismActivityIdParamSchema.safeParse(request.params);
        const body = updateTourismActivityBodySchema.safeParse(request.body);
        if (!params.success || !body.success) {
            return reply.code(400).send({
                message: "Invalid tourism activity payload",
                issues: body.success ? undefined : body.error.flatten(),
            });
        }
        try {
            return reply.send(
                await catalog.updateActivity(
                    request.user.sub,
                    params.data.id,
                    body.data,
                    auditFromRequest(request)
                )
            );
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.post(
        "/admin/tourism/activities/:id/schedule-review",
        { ...adminGuard },
        async (request, reply) => {
            const params = tourismActivityIdParamSchema.safeParse(request.params);
            const body = confirmTourismScheduleReviewBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return reply.code(400).send({
                    message: "Invalid schedule review payload",
                    issues: body.success ? undefined : body.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await catalog.confirmActivityScheduleReview(
                        request.user.sub,
                        params.data.id,
                        body.data,
                        auditFromRequest(request)
                    )
                );
            } catch (error) {
                return handleTourismError(error, reply);
            }
        }
    );

    // --- Events ---
    app.get("/admin/tourism/event-types", { ...adminGuard }, async (_request, reply) => {
        return reply.send({ items: await catalog.listEventTypes() });
    });

    app.get("/admin/tourism/events", { ...adminGuard }, async (request, reply) => {
        const query = listAdminTourismEventsQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid tourism events query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(await catalog.listEvents(query.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/admin/tourism/events/:id", { ...adminGuard }, async (request, reply) => {
        const params = tourismEventIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ message: "Invalid event id" });
        }
        try {
            return reply.send(await catalog.getEvent(params.data.id));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.post("/admin/tourism/events", { ...adminGuard }, async (request, reply) => {
        const body = createTourismEventBodySchema.safeParse(request.body);
        if (!body.success) {
            return reply.code(400).send({
                message: "Invalid tourism event payload",
                issues: body.error.flatten(),
            });
        }
        try {
            const created = await catalog.createEvent(
                request.user.sub,
                body.data,
                auditFromRequest(request)
            );
            return reply.code(201).send(created);
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.patch("/admin/tourism/events/:id", { ...adminGuard }, async (request, reply) => {
        const params = tourismEventIdParamSchema.safeParse(request.params);
        const body = updateTourismEventBodySchema.safeParse(request.body);
        if (!params.success || !body.success) {
            return reply.code(400).send({
                message: "Invalid tourism event payload",
                issues: body.success ? undefined : body.error.flatten(),
            });
        }
        try {
            return reply.send(
                await catalog.updateEvent(
                    request.user.sub,
                    params.data.id,
                    body.data,
                    auditFromRequest(request)
                )
            );
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.post(
        "/admin/tourism/events/:id/schedule-review",
        { ...adminGuard },
        async (request, reply) => {
            const params = tourismEventIdParamSchema.safeParse(request.params);
            const body = confirmTourismScheduleReviewBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return reply.code(400).send({
                    message: "Invalid schedule review payload",
                    issues: body.success ? undefined : body.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await catalog.confirmEventScheduleReview(
                        request.user.sub,
                        params.data.id,
                        body.data,
                        auditFromRequest(request)
                    )
                );
            } catch (error) {
                return handleTourismError(error, reply);
            }
        }
    );

    // --- Occurrences (nested under event; event id from path only) ---
    app.get(
        "/admin/tourism/events/:eventId/occurrences",
        { ...adminGuard },
        async (request, reply) => {
            const params = tourismEventOccurrencesParamSchema.safeParse(request.params);
            const query = listTourismOccurrencesQuerySchema.safeParse(request.query);
            if (!params.success || !query.success) {
                return reply.code(400).send({ message: "Invalid occurrence list query" });
            }
            try {
                return reply.send(
                    await catalog.listOccurrences(params.data.eventId, query.data)
                );
            } catch (error) {
                return handleTourismError(error, reply);
            }
        }
    );

    app.post(
        "/admin/tourism/events/:eventId/occurrences",
        { ...adminGuard },
        async (request, reply) => {
            const params = tourismEventOccurrencesParamSchema.safeParse(request.params);
            const body = createTourismOccurrenceBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return reply.code(400).send({
                    message: "Invalid occurrence payload",
                    issues: body.success ? undefined : body.error.flatten(),
                });
            }
            try {
                const created = await catalog.createOccurrence(
                    request.user.sub,
                    params.data.eventId,
                    body.data,
                    auditFromRequest(request)
                );
                return reply.code(201).send(created);
            } catch (error) {
                return handleTourismError(error, reply);
            }
        }
    );

    app.patch(
        "/admin/tourism/events/:eventId/occurrences/:occurrenceId",
        { ...adminGuard },
        async (request, reply) => {
            const params = tourismEventOccurrenceIdParamSchema.safeParse(request.params);
            const body = updateTourismOccurrenceBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return reply.code(400).send({
                    message: "Invalid occurrence payload",
                    issues: body.success ? undefined : body.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await catalog.updateOccurrence(
                        request.user.sub,
                        params.data.eventId,
                        params.data.occurrenceId,
                        body.data,
                        auditFromRequest(request)
                    )
                );
            } catch (error) {
                return handleTourismError(error, reply);
            }
        }
    );

    // --- Public foods / guides / advisories ---
    app.get("/tourism/foods", async (request, reply) => {
        const query = listPublicTourismFoodsQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid tourism foods query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(await visitor.listPublicFoods(query.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/tourism/foods/:id", async (request, reply) => {
        const params = tourismFoodIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ message: "Invalid food id" });
        }
        try {
            return reply.send(await visitor.getPublicFood(params.data.id));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/tourism/guides", async (request, reply) => {
        const query = listPublicTourismGuidesQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid tourism guides query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(await visitor.listPublicGuides(query.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/tourism/advisories", async (request, reply) => {
        const query = listPublicTourismAdvisoriesQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid tourism advisories query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(await visitor.listPublicAdvisories(query.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    // --- Admin foods ---
    app.get("/admin/tourism/foods", { ...adminGuard }, async (request, reply) => {
        const query = listAdminTourismFoodsQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid tourism foods query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(await visitor.listAdminFoods(query.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/admin/tourism/foods/:id", { ...adminGuard }, async (request, reply) => {
        const params = tourismFoodIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ message: "Invalid food id" });
        }
        try {
            return reply.send(await visitor.getAdminFood(params.data.id));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.post("/admin/tourism/foods", { ...adminGuard }, async (request, reply) => {
        const body = createTourismFoodBodySchema.safeParse(request.body);
        if (!body.success) {
            return reply.code(400).send({
                message: "Invalid tourism food payload",
                issues: body.error.flatten(),
            });
        }
        try {
            const created = await visitor.createFood(
                request.user.sub,
                body.data,
                auditFromRequest(request)
            );
            return reply.code(201).send(created);
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.patch("/admin/tourism/foods/:id", { ...adminGuard }, async (request, reply) => {
        const params = tourismFoodIdParamSchema.safeParse(request.params);
        const body = updateTourismFoodBodySchema.safeParse(request.body);
        if (!params.success || !body.success) {
            return reply.code(400).send({
                message: "Invalid tourism food payload",
                issues: body.success ? undefined : body.error.flatten(),
            });
        }
        try {
            return reply.send(
                await visitor.updateFood(
                    request.user.sub,
                    params.data.id,
                    body.data,
                    auditFromRequest(request)
                )
            );
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.post("/admin/tourism/foods/:foodId/places", { ...adminGuard }, async (request, reply) => {
        const params = tourismFoodPlacesCreateParamSchema.safeParse(request.params);
        const body = createTourismFoodPlaceLinkBodySchema.safeParse(request.body);
        if (!params.success || !body.success) {
            return reply.code(400).send({
                message: "Invalid food place link payload",
                issues: body.success ? undefined : body.error.flatten(),
            });
        }
        try {
            const created = await visitor.createFoodPlaceLink(
                request.user.sub,
                params.data.foodId,
                body.data,
                auditFromRequest(request)
            );
            return reply.code(201).send(created);
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.patch(
        "/admin/tourism/foods/:foodId/places/:placePublicId",
        { ...adminGuard },
        async (request, reply) => {
            const params = tourismFoodPlaceParamSchema.safeParse(request.params);
            const body = updateTourismFoodPlaceLinkBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return reply.code(400).send({
                    message: "Invalid food place link payload",
                    issues: body.success ? undefined : body.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await visitor.updateFoodPlaceLink(
                        request.user.sub,
                        params.data.foodId,
                        params.data.placePublicId,
                        body.data,
                        auditFromRequest(request)
                    )
                );
            } catch (error) {
                return handleTourismError(error, reply);
            }
        }
    );

    app.delete(
        "/admin/tourism/foods/:foodId/places/:placePublicId",
        { ...adminGuard },
        async (request, reply) => {
            const params = tourismFoodPlaceParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({ message: "Invalid food place link id" });
            }
            try {
                return reply.send(
                    await visitor.deleteFoodPlaceLink(
                        request.user.sub,
                        params.data.foodId,
                        params.data.placePublicId,
                        auditFromRequest(request)
                    )
                );
            } catch (error) {
                return handleTourismError(error, reply);
            }
        }
    );

    // --- Admin guides ---
    app.get("/admin/tourism/guides", { ...adminGuard }, async (request, reply) => {
        const query = listAdminTourismGuidesQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid tourism guides query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(await visitor.listAdminGuides(query.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/admin/tourism/guides/:id", { ...adminGuard }, async (request, reply) => {
        const params = tourismGuideIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ message: "Invalid guide id" });
        }
        try {
            return reply.send(await visitor.getAdminGuide(params.data.id));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.post("/admin/tourism/guides", { ...adminGuard }, async (request, reply) => {
        const body = createTourismGuideBodySchema.safeParse(request.body);
        if (!body.success) {
            return reply.code(400).send({
                message: "Invalid tourism guide payload",
                issues: body.error.flatten(),
            });
        }
        try {
            const created = await visitor.createGuide(
                request.user.sub,
                body.data,
                auditFromRequest(request)
            );
            return reply.code(201).send(created);
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.patch("/admin/tourism/guides/:id", { ...adminGuard }, async (request, reply) => {
        const params = tourismGuideIdParamSchema.safeParse(request.params);
        const body = updateTourismGuideBodySchema.safeParse(request.body);
        if (!params.success || !body.success) {
            return reply.code(400).send({
                message: "Invalid tourism guide payload",
                issues: body.success ? undefined : body.error.flatten(),
            });
        }
        try {
            return reply.send(
                await visitor.updateGuide(
                    request.user.sub,
                    params.data.id,
                    body.data,
                    auditFromRequest(request)
                )
            );
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    // --- Admin advisories ---
    app.get("/admin/tourism/advisories", { ...adminGuard }, async (request, reply) => {
        const query = listAdminTourismAdvisoriesQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid tourism advisories query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(await visitor.listAdminAdvisories(query.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/admin/tourism/advisories/:id", { ...adminGuard }, async (request, reply) => {
        const params = tourismAdvisoryIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ message: "Invalid advisory id" });
        }
        try {
            return reply.send(await visitor.getAdminAdvisory(params.data.id));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.post("/admin/tourism/advisories", { ...adminGuard }, async (request, reply) => {
        const body = createTourismAdvisoryBodySchema.safeParse(request.body);
        if (!body.success) {
            return reply.code(400).send({
                message: "Invalid tourism advisory payload",
                issues: body.error.flatten(),
            });
        }
        try {
            const created = await visitor.createAdvisory(
                request.user.sub,
                body.data,
                auditFromRequest(request)
            );
            return reply.code(201).send(created);
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.patch("/admin/tourism/advisories/:id", { ...adminGuard }, async (request, reply) => {
        const params = tourismAdvisoryIdParamSchema.safeParse(request.params);
        const body = updateTourismAdvisoryBodySchema.safeParse(request.body);
        if (!params.success || !body.success) {
            return reply.code(400).send({
                message: "Invalid tourism advisory payload",
                issues: body.success ? undefined : body.error.flatten(),
            });
        }
        try {
            return reply.send(
                await visitor.updateAdvisory(
                    request.user.sub,
                    params.data.id,
                    body.data,
                    auditFromRequest(request)
                )
            );
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    // --- Admin research candidates (staging only — never public) ---
    app.get("/admin/tourism/research", { ...adminGuard }, async (request, reply) => {
        const query = listAdminTourismResearchQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.code(400).send({
                message: "Invalid tourism research query",
                issues: query.error.flatten(),
            });
        }
        try {
            return reply.send(await research.list(query.data));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/admin/tourism/research/:id", { ...adminGuard }, async (request, reply) => {
        const params = tourismResearchIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ message: "Invalid research candidate id" });
        }
        try {
            return reply.send(await research.get(params.data.id));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.get("/admin/tourism/research/:id/prefill", { ...adminGuard }, async (request, reply) => {
        const params = tourismResearchIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ message: "Invalid research candidate id" });
        }
        try {
            return reply.send(await research.getPrefill(params.data.id));
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.post("/admin/tourism/research/import", { ...adminGuard }, async (request, reply) => {
        const body = bulkImportTourismResearchBodySchema.safeParse(request.body);
        if (!body.success) {
            return reply.code(400).send({
                message: "Invalid tourism research import payload",
                issues: body.error.flatten(),
            });
        }
        try {
            const created = await research.bulkImport(
                request.user.sub,
                body.data,
                auditFromRequest(request)
            );
            return reply.code(201).send(created);
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.patch("/admin/tourism/research/:id/status", { ...adminGuard }, async (request, reply) => {
        const params = tourismResearchIdParamSchema.safeParse(request.params);
        const body = updateTourismResearchStatusBodySchema.safeParse(request.body);
        if (!params.success || !body.success) {
            return reply.code(400).send({
                message: "Invalid tourism research status payload",
                issues: body.success ? undefined : body.error.flatten(),
            });
        }
        try {
            return reply.send(
                await research.updateStatus(
                    request.user.sub,
                    params.data.id,
                    body.data,
                    auditFromRequest(request)
                )
            );
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.post("/admin/tourism/research/:id/reviewing", { ...adminGuard }, async (request, reply) => {
        const params = tourismResearchIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ message: "Invalid research candidate id" });
        }
        try {
            return reply.send(
                await research.markReviewing(
                    request.user.sub,
                    params.data.id,
                    auditFromRequest(request)
                )
            );
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.post("/admin/tourism/research/:id/reject", { ...adminGuard }, async (request, reply) => {
        const params = tourismResearchIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({ message: "Invalid research candidate id" });
        }
        try {
            return reply.send(
                await research.markRejected(
                    request.user.sub,
                    params.data.id,
                    auditFromRequest(request)
                )
            );
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });

    app.post(
        "/admin/tourism/research/:id/needs-research",
        { ...adminGuard },
        async (request, reply) => {
            const params = tourismResearchIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({ message: "Invalid research candidate id" });
            }
            try {
                return reply.send(
                    await research.markNeedsResearch(
                        request.user.sub,
                        params.data.id,
                        auditFromRequest(request)
                    )
                );
            } catch (error) {
                return handleTourismError(error, reply);
            }
        }
    );

    app.post("/admin/tourism/research/:id/added", { ...adminGuard }, async (request, reply) => {
        const params = tourismResearchIdParamSchema.safeParse(request.params);
        const body = markTourismResearchAddedBodySchema.safeParse(request.body);
        if (!params.success || !body.success) {
            return reply.code(400).send({
                message: "Invalid tourism research added payload",
                issues: body.success ? undefined : body.error.flatten(),
            });
        }
        try {
            return reply.send(
                await research.markAdded(
                    request.user.sub,
                    params.data.id,
                    body.data,
                    auditFromRequest(request)
                )
            );
        } catch (error) {
            return handleTourismError(error, reply);
        }
    });
};

export default tourismRoutes;

export async function registerTourismWithRateLimit(
    app: Parameters<FastifyPluginAsync>[0],
    opts: TourismRoutesOptions = {}
) {
    await app.register(rateLimit, { global: false });
    await app.register(tourismRoutes, opts);
}
