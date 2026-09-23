import type { FastifyPluginAsync, FastifyReply } from "fastify";

import type { JwtUser } from "../../plugins/auth.js";
import {
    approveNamePairReviewBodySchema,
    listNamePairGapsQuerySchema,
    listNamePairReviewsQuerySchema,
    namePairPublicIdParamSchema,
    rejectOrSkipNamePairReviewBodySchema,
} from "./name-pair-reviews.schema.js";
import { NamePairReviewsRepository } from "./name-pair-reviews.repo.js";
import {
    NamePairReviewsError,
    NamePairReviewsService,
} from "./name-pair-reviews.service.js";

function handleError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof NamePairReviewsError) {
        return reply.code(error.statusCode).send({ message: error.message });
    }
    throw error;
}

function editorIdFromJwt(user: JwtUser | undefined): bigint {
    const raw = user?.id?.trim();
    if (!raw || !/^\d+$/.test(raw)) {
        throw new NamePairReviewsError("Authenticated user required", 401);
    }
    return BigInt(raw);
}

const namePairReviewsRoutes: FastifyPluginAsync = async (app) => {
    const service = new NamePairReviewsService(new NamePairReviewsRepository(app.prisma));
    const readGuard = { preHandler: [app.authenticate, app.requireDashboardAccess] };
    const writeGuard = {
        preHandler: [app.authenticate, app.requireRole("admin", "super_admin")],
    };

    app.get("/admin/name-pair-reviews", { ...readGuard }, async (request, reply) => {
        const parsed = listNamePairReviewsQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid name pair reviews list query",
                issues: parsed.error.flatten(),
            });
        }
        return reply.send(await service.list(parsed.data));
    });

    app.get("/admin/name-pair-reviews/summary", { ...readGuard }, async (_request, reply) => {
        return reply.send(await service.summary());
    });

    app.get("/admin/name-pair-reviews/gaps", { ...readGuard }, async (request, reply) => {
        const parsed = listNamePairGapsQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({
                message: "Invalid name pair gaps list query",
                issues: parsed.error.flatten(),
            });
        }
        return reply.send(await service.listGaps(parsed.data));
    });

    app.get("/admin/name-pair-reviews/:publicId", { ...readGuard }, async (request, reply) => {
        const params = namePairPublicIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return reply.code(400).send({
                message: "Invalid name pair review id",
                issues: params.error.flatten(),
            });
        }
        try {
            return reply.send(await service.getByPublicId(params.data.publicId));
        } catch (error) {
            return handleError(error, reply);
        }
    });

    app.post(
        "/admin/name-pair-reviews/:publicId/approve",
        { ...writeGuard },
        async (request, reply) => {
            const params = namePairPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid name pair review id",
                    issues: params.error.flatten(),
                });
            }
            const body = approveNamePairReviewBodySchema.safeParse(request.body ?? {});
            if (!body.success) {
                return reply.code(400).send({
                    message: "Invalid approve payload",
                    issues: body.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await service.approve(
                        params.data.publicId,
                        body.data,
                        editorIdFromJwt(request.user),
                    ),
                );
            } catch (error) {
                return handleError(error, reply);
            }
        },
    );

    app.post(
        "/admin/name-pair-reviews/:publicId/reject",
        { ...writeGuard },
        async (request, reply) => {
            const params = namePairPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid name pair review id",
                    issues: params.error.flatten(),
                });
            }
            const body = rejectOrSkipNamePairReviewBodySchema.safeParse(request.body ?? {});
            if (!body.success) {
                return reply.code(400).send({
                    message: "Invalid reject payload",
                    issues: body.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await service.reject(
                        params.data.publicId,
                        body.data,
                        editorIdFromJwt(request.user),
                    ),
                );
            } catch (error) {
                return handleError(error, reply);
            }
        },
    );

    app.post(
        "/admin/name-pair-reviews/:publicId/skip",
        { ...writeGuard },
        async (request, reply) => {
            const params = namePairPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid name pair review id",
                    issues: params.error.flatten(),
                });
            }
            const body = rejectOrSkipNamePairReviewBodySchema.safeParse(request.body ?? {});
            if (!body.success) {
                return reply.code(400).send({
                    message: "Invalid skip payload",
                    issues: body.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await service.skip(
                        params.data.publicId,
                        body.data,
                        editorIdFromJwt(request.user),
                    ),
                );
            } catch (error) {
                return handleError(error, reply);
            }
        },
    );
};

export default namePairReviewsRoutes;
