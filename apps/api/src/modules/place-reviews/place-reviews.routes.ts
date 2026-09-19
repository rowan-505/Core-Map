import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync, FastifyReply, FastifySchema } from "fastify";

import { PlaceReviewsError } from "./place-reviews.errors.js";
import type { PlaceReviewAdminModerationAction } from "./place-reviews.moderation.js";
import {
    deletePlaceReviewSchema,
    getAdminPlaceReviewSchema,
    getAdminPlaceReviewsSchema,
    getMyPlaceReviewSchema,
    getPublishedPlaceReviewsSchema,
    patchAdminPlaceReviewStatusSchema,
    patchPlaceReviewSchema,
    postAdminPlaceReviewHideSchema,
    postAdminPlaceReviewPublishSchema,
    postAdminPlaceReviewRejectSchema,
    postAdminPlaceReviewRestoreSchema,
    postPlaceReviewSchema,
    postRefreshPlaceRatingSummarySchema,
} from "./place-reviews.openapi.js";
import { PlaceReviewsRepository } from "./place-reviews.repo.js";
import {
    adminPlaceReviewModerationNoteBodySchema,
    adminPlaceReviewsQuerySchema,
    createPlaceReviewBodySchema,
    listPublishedPlaceReviewsQuerySchema,
    moderatePlaceReviewBodySchema,
    placeReviewIdParamSchema,
    placeReviewPlaceIdParamSchema,
    updatePlaceReviewBodySchema,
} from "./place-reviews.schema.js";
import { PlaceReviewsService } from "./place-reviews.service.js";

export const CREATE_PLACE_REVIEW_RATE_LIMIT = { max: 20, timeWindow: "1 minute" } as const;
export const UPDATE_PLACE_REVIEW_RATE_LIMIT = { max: 30, timeWindow: "1 minute" } as const;

export type PlaceReviewsRoutesOptions = {
    service?: PlaceReviewsService;
};

function handlePlaceReviewsError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof PlaceReviewsError) {
        return reply.code(error.statusCode).send({
            message: error.message,
            ...(error.code ? { code: error.code } : {}),
        });
    }
    throw error;
}

const placeReviewsRoutes: FastifyPluginAsync<PlaceReviewsRoutesOptions> = async (app, opts) => {
    const service =
        opts.service ?? new PlaceReviewsService(new PlaceReviewsRepository(app.prisma));
    const adminGuard = {
        preHandler: [app.authenticate, app.requireRole("admin", "super_admin")],
    };

    app.get("/places/:placeId/reviews", { schema: getPublishedPlaceReviewsSchema }, async (request, reply) => {
        const params = placeReviewPlaceIdParamSchema.safeParse(request.params);
        const query = listPublishedPlaceReviewsQuerySchema.safeParse(request.query);
        if (!params.success || !query.success) {
            return reply.code(400).send({ message: "Invalid place reviews query" });
        }
        try {
            return reply.send(await service.listPublishedReviews(params.data.placeId, query.data));
        } catch (error) {
            return handlePlaceReviewsError(error, reply);
        }
    });

    app.post(
        "/places/:placeId/reviews",
        {
            preHandler: app.authenticate,
            schema: postPlaceReviewSchema,
            config: { rateLimit: CREATE_PLACE_REVIEW_RATE_LIMIT },
        },
        async (request, reply) => {
            const params = placeReviewPlaceIdParamSchema.safeParse(request.params);
            const body = createPlaceReviewBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return reply.code(400).send({ message: "Invalid place review payload" });
            }
            try {
                const created = await service.createReview(
                    request.user.sub,
                    params.data.placeId,
                    body.data
                );
                return reply.code(201).send(created);
            } catch (error) {
                return handlePlaceReviewsError(error, reply);
            }
        }
    );

    app.get(
        "/places/:placeId/my-review",
        { preHandler: app.authenticate, schema: getMyPlaceReviewSchema },
        async (request, reply) => {
            const params = placeReviewPlaceIdParamSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ message: "Invalid place id" });
            try {
                return reply.send(
                    await service.findMyReviewForPlace(request.user.sub, params.data.placeId)
                );
            } catch (error) {
                return handlePlaceReviewsError(error, reply);
            }
        }
    );

    app.patch(
        "/reviews/:reviewId",
        {
            preHandler: app.authenticate,
            schema: patchPlaceReviewSchema,
            config: { rateLimit: UPDATE_PLACE_REVIEW_RATE_LIMIT },
        },
        async (request, reply) => {
            const params = placeReviewIdParamSchema.safeParse(request.params);
            const body = updatePlaceReviewBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return reply.code(400).send({ message: "Invalid place review payload" });
            }
            try {
                return reply.send(
                    await service.updateOwnReview(request.user.sub, params.data.reviewId, body.data)
                );
            } catch (error) {
                return handlePlaceReviewsError(error, reply);
            }
        }
    );

    app.delete(
        "/reviews/:reviewId",
        {
            preHandler: app.authenticate,
            schema: deletePlaceReviewSchema,
            config: { rateLimit: UPDATE_PLACE_REVIEW_RATE_LIMIT },
        },
        async (request, reply) => {
            const params = placeReviewIdParamSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ message: "Invalid review id" });
            try {
                return reply.send(
                    await service.softDeleteOwnReview(request.user.sub, params.data.reviewId)
                );
            } catch (error) {
                return handlePlaceReviewsError(error, reply);
            }
        }
    );

    app.get("/admin/reviews", { ...adminGuard, schema: getAdminPlaceReviewsSchema }, async (request, reply) => {
        const query = adminPlaceReviewsQuerySchema.safeParse(request.query);
        if (!query.success) return reply.code(400).send({ message: "Invalid admin reviews query" });
        try {
            return reply.send(await service.listAdminReviews(query.data));
        } catch (error) {
            return handlePlaceReviewsError(error, reply);
        }
    });

    app.get(
        "/admin/reviews/:reviewId",
        { ...adminGuard, schema: getAdminPlaceReviewSchema },
        async (request, reply) => {
            const params = placeReviewIdParamSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ message: "Invalid review id" });
            try {
                return reply.send(await service.getAdminReview(params.data.reviewId));
            } catch (error) {
                return handlePlaceReviewsError(error, reply);
            }
        }
    );

    const registerAdminAction = (
        action: PlaceReviewAdminModerationAction,
        schema: FastifySchema
    ) => {
        app.post(
            `/admin/reviews/:reviewId/${action}`,
            { ...adminGuard, schema },
            async (request, reply) => {
                const params = placeReviewIdParamSchema.safeParse(request.params);
                const body = adminPlaceReviewModerationNoteBodySchema.safeParse(request.body ?? {});
                if (!params.success || !body.success) {
                    return reply.code(400).send({ message: "Invalid moderation payload" });
                }
                try {
                    return reply.send(
                        await service.applyAdminAction(
                            request.user.sub,
                            params.data.reviewId,
                            action,
                            body.data,
                            {
                                ipAddress: request.ip,
                                userAgent: request.headers["user-agent"] ?? null,
                            }
                        )
                    );
                } catch (error) {
                    return handlePlaceReviewsError(error, reply);
                }
            }
        );
    };

    registerAdminAction("publish", postAdminPlaceReviewPublishSchema);
    registerAdminAction("reject", postAdminPlaceReviewRejectSchema);
    registerAdminAction("hide", postAdminPlaceReviewHideSchema);
    registerAdminAction("restore", postAdminPlaceReviewRestoreSchema);

    app.patch(
        "/admin/reviews/:reviewId/status",
        { ...adminGuard, schema: patchAdminPlaceReviewStatusSchema },
        async (request, reply) => {
            const params = placeReviewIdParamSchema.safeParse(request.params);
            const body = moderatePlaceReviewBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return reply.code(400).send({ message: "Invalid moderation payload" });
            }
            try {
                return reply.send(
                    await service.changeModerationStatus(
                        request.user.sub,
                        params.data.reviewId,
                        body.data,
                        {
                            ipAddress: request.ip,
                            userAgent: request.headers["user-agent"] ?? null,
                        }
                    )
                );
            } catch (error) {
                return handlePlaceReviewsError(error, reply);
            }
        }
    );

    app.post(
        "/admin/places/:placeId/rating-summary/refresh",
        { ...adminGuard, schema: postRefreshPlaceRatingSummarySchema },
        async (request, reply) => {
            const params = placeReviewPlaceIdParamSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ message: "Invalid place id" });
            try {
                return reply.send(await service.refreshRatingSummary(params.data.placeId));
            } catch (error) {
                return handlePlaceReviewsError(error, reply);
            }
        }
    );
};

export default placeReviewsRoutes;

export async function registerPlaceReviewsWithRateLimit(
    app: Parameters<FastifyPluginAsync>[0],
    opts: PlaceReviewsRoutesOptions = {}
) {
    await app.register(rateLimit, { global: false });
    await app.register(placeReviewsRoutes, opts);
}
