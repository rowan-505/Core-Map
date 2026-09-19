import type { FastifyPluginAsync, FastifyReply } from "fastify";

import { CommunityRepository } from "./community.repo.js";
import { CommunityError, CommunityService } from "./community.service.js";
import {
    adminCommunityPostsQuerySchema,
    adminModerationActionParamSchema,
    adminModerationBodySchema,
    communityListQuerySchema,
    communityPostPublicIdParamSchema,
    createCommunityPostBodySchema,
    myCommunityPostsQuerySchema,
    patchCommunityPostBodySchema,
    putCommunityReactionBodySchema,
} from "./community.schema.js";
import {
    deleteCommunityPostSchema,
    deleteCommunityReactionSchema,
    getAdminCommunityPostSchema,
    getAdminCommunityPostsSchema,
    getAdminCommunityCountsSchema,
    getCommunityPostSchema,
    getCommunityPostsSchema,
    getMyCommunityPostsSchema,
    patchCommunityPostSchema,
    postAdminCommunityModerationSchema,
    postCommunityPostSchema,
    putCommunityReactionSchema,
} from "./community.openapi.js";

function handleCommunityError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof CommunityError) {
        return reply.code(error.statusCode).send({
            message: error.message,
            ...(error.code ? { code: error.code } : {}),
        });
    }
    throw error;
}

const CREATE_POST_RATE_LIMIT = { max: 20, timeWindow: "1 minute" } as const;
const REACTION_RATE_LIMIT = { max: 30, timeWindow: "1 minute" } as const;

const communityRoutes: FastifyPluginAsync = async (app) => {
    const repo = new CommunityRepository(app.prisma);
    const service = new CommunityService(repo);
    const requireAdmin = app.requireRole("admin", "super_admin");
    const adminGuard = { preHandler: [app.authenticate, requireAdmin] };

    app.get(
        "/community/posts",
        { schema: getCommunityPostsSchema },
        async (request, reply) => {
            const parsed = communityListQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid community posts query",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                return reply.send(await service.listPublicFeed(parsed.data));
            } catch (error) {
                return handleCommunityError(error, reply);
            }
        }
    );

    app.get(
        "/community/posts/:publicId",
        { schema: getCommunityPostSchema },
        async (request, reply) => {
            const params = communityPostPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid post id",
                    issues: params.error.flatten(),
                });
            }

            let viewer: { publicId: string; roles: string[] } | null = null;
            if (request.headers.authorization) {
                try {
                    await request.jwtVerify();
                    viewer = {
                        publicId: request.user.sub,
                        roles: request.user.roles ?? [],
                    };
                } catch {
                    viewer = null;
                }
            }

            try {
                return reply.send(await service.getPublicPost(params.data.publicId, viewer));
            } catch (error) {
                return handleCommunityError(error, reply);
            }
        }
    );

    app.post(
        "/community/posts",
        {
            preHandler: app.authenticate,
            schema: postCommunityPostSchema,
            config: { rateLimit: CREATE_POST_RATE_LIMIT },
        },
        async (request, reply) => {
            const body = createCommunityPostBodySchema.safeParse(request.body);
            if (!body.success) {
                return reply.code(400).send({
                    message: "Invalid community post payload",
                    issues: body.error.flatten(),
                });
            }
            try {
                const created = await service.createPost(request.user.sub, body.data);
                return reply.code(201).send(created);
            } catch (error) {
                return handleCommunityError(error, reply);
            }
        }
    );

    app.patch(
        "/community/posts/:publicId",
        {
            preHandler: app.authenticate,
            schema: patchCommunityPostSchema,
        },
        async (request, reply) => {
            const params = communityPostPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid post id",
                    issues: params.error.flatten(),
                });
            }
            const body = patchCommunityPostBodySchema.safeParse(request.body);
            if (!body.success) {
                return reply.code(400).send({
                    message: "Invalid community post update",
                    issues: body.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await service.patchPost(request.user.sub, params.data.publicId, body.data)
                );
            } catch (error) {
                return handleCommunityError(error, reply);
            }
        }
    );

    app.delete(
        "/community/posts/:publicId",
        {
            preHandler: app.authenticate,
            schema: deleteCommunityPostSchema,
        },
        async (request, reply) => {
            const params = communityPostPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid post id",
                    issues: params.error.flatten(),
                });
            }
            try {
                return reply.send(await service.deletePost(request.user.sub, params.data.publicId));
            } catch (error) {
                return handleCommunityError(error, reply);
            }
        }
    );

    app.put(
        "/community/posts/:publicId/reaction",
        {
            preHandler: app.authenticate,
            schema: putCommunityReactionSchema,
            config: { rateLimit: REACTION_RATE_LIMIT },
        },
        async (request, reply) => {
            const params = communityPostPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid post id",
                    issues: params.error.flatten(),
                });
            }
            const body = putCommunityReactionBodySchema.safeParse(request.body);
            if (!body.success) {
                return reply.code(400).send({
                    message: "Invalid reaction payload",
                    issues: body.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await service.putReaction(
                        request.user.sub,
                        params.data.publicId,
                        body.data.reactionType
                    )
                );
            } catch (error) {
                return handleCommunityError(error, reply);
            }
        }
    );

    app.delete(
        "/community/posts/:publicId/reaction",
        {
            preHandler: app.authenticate,
            schema: deleteCommunityReactionSchema,
            config: { rateLimit: REACTION_RATE_LIMIT },
        },
        async (request, reply) => {
            const params = communityPostPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid post id",
                    issues: params.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await service.deleteReaction(request.user.sub, params.data.publicId)
                );
            } catch (error) {
                return handleCommunityError(error, reply);
            }
        }
    );

    app.get(
        "/me/community-posts",
        {
            preHandler: app.authenticate,
            schema: getMyCommunityPostsSchema,
        },
        async (request, reply) => {
            const query = myCommunityPostsQuerySchema.safeParse(request.query);
            if (!query.success) {
                return reply.code(400).send({
                    message: "Invalid my community posts query",
                    issues: query.error.flatten(),
                });
            }
            try {
                return reply.send(await service.listMyPosts(request.user.sub, query.data));
            } catch (error) {
                return handleCommunityError(error, reply);
            }
        }
    );

    app.get(
        "/admin/community/posts/counts",
        {
            ...adminGuard,
            schema: getAdminCommunityCountsSchema,
        },
        async (_request, reply) => {
            try {
                return reply.send(await service.getAdminCounts());
            } catch (error) {
                return handleCommunityError(error, reply);
            }
        }
    );

    app.get(
        "/admin/community/posts",
        {
            ...adminGuard,
            schema: getAdminCommunityPostsSchema,
        },
        async (request, reply) => {
            const query = adminCommunityPostsQuerySchema.safeParse(request.query);
            if (!query.success) {
                return reply.code(400).send({
                    message: "Invalid admin community posts query",
                    issues: query.error.flatten(),
                });
            }
            try {
                return reply.send(await service.listAdminPosts(query.data));
            } catch (error) {
                return handleCommunityError(error, reply);
            }
        }
    );

    app.get(
        "/admin/community/posts/:publicId",
        {
            ...adminGuard,
            schema: getAdminCommunityPostSchema,
        },
        async (request, reply) => {
            const params = communityPostPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid post id",
                    issues: params.error.flatten(),
                });
            }
            try {
                return reply.send(await service.getAdminPost(params.data.publicId));
            } catch (error) {
                return handleCommunityError(error, reply);
            }
        }
    );

    app.post(
        "/admin/community/posts/:publicId/:action",
        {
            ...adminGuard,
            schema: postAdminCommunityModerationSchema,
        },
        async (request, reply) => {
            const params = adminModerationActionParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid moderation action",
                    issues: params.error.flatten(),
                });
            }
            const body = adminModerationBodySchema.safeParse(request.body ?? {});
            if (!body.success) {
                return reply.code(400).send({
                    message: "Invalid moderation payload",
                    issues: body.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await service.moderate(
                        request.user.sub,
                        params.data.publicId,
                        params.data.action,
                        body.data.note
                    )
                );
            } catch (error) {
                return handleCommunityError(error, reply);
            }
        }
    );
};

export default communityRoutes;
