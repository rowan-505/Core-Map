import type { FastifyPluginAsync, FastifyReply } from "fastify";

import { NotificationsRepository } from "./notifications.repo.js";
import { NotificationsError, NotificationsService } from "./notifications.service.js";
import {
    notificationPublicIdParamSchema,
    notificationsListQuerySchema,
} from "./notifications.schema.js";
import {
    getNotificationsSchema,
    getNotificationsUnreadCountSchema,
    patchNotificationReadSchema,
    postNotificationsReadAllSchema,
} from "./notifications.openapi.js";

function handleNotificationsError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof NotificationsError) {
        return reply.code(error.statusCode).send({
            message: error.message,
            ...(error.code ? { code: error.code } : {}),
        });
    }
    throw error;
}

const notificationsRoutes: FastifyPluginAsync = async (app) => {
    const repo = new NotificationsRepository(app.prisma);
    const service = new NotificationsService(repo);

    app.get(
        "/notifications",
        {
            preHandler: app.authenticate,
            schema: getNotificationsSchema,
        },
        async (request, reply) => {
            const query = notificationsListQuerySchema.safeParse(request.query);
            if (!query.success) {
                return reply.code(400).send({
                    message: "Invalid notifications query",
                    issues: query.error.flatten(),
                });
            }
            try {
                return reply.send(await service.list(request.user.sub, query.data));
            } catch (error) {
                return handleNotificationsError(error, reply);
            }
        }
    );

    app.get(
        "/notifications/unread-count",
        {
            preHandler: app.authenticate,
            schema: getNotificationsUnreadCountSchema,
        },
        async (request, reply) => {
            try {
                return reply.send(await service.unreadCount(request.user.sub));
            } catch (error) {
                return handleNotificationsError(error, reply);
            }
        }
    );

    app.patch(
        "/notifications/:publicId/read",
        {
            preHandler: app.authenticate,
            schema: patchNotificationReadSchema,
        },
        async (request, reply) => {
            const params = notificationPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({
                    message: "Invalid notification id",
                    issues: params.error.flatten(),
                });
            }
            try {
                return reply.send(await service.markRead(request.user.sub, params.data.publicId));
            } catch (error) {
                return handleNotificationsError(error, reply);
            }
        }
    );

    app.post(
        "/notifications/read-all",
        {
            preHandler: app.authenticate,
            schema: postNotificationsReadAllSchema,
        },
        async (request, reply) => {
            try {
                return reply.send(await service.markAllRead(request.user.sub));
            } catch (error) {
                return handleNotificationsError(error, reply);
            }
        }
    );
};

export default notificationsRoutes;
