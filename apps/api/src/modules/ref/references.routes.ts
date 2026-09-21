import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { ReferencesRepository } from "./references.repo.js";
import { ReferencesError, ReferencesService } from "./references.service.js";

function handleError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof ReferencesError) {
        return reply.code(error.statusCode).send({ message: error.message });
    }
    throw error;
}

const referencesRoutes: FastifyPluginAsync = async (app) => {
    const service = new ReferencesService(new ReferencesRepository(app.prisma));
    const readGuard = { preHandler: [app.authenticate, app.requireDashboardAccess] };
    const writeGuard = { preHandler: [app.authenticate, app.requireDashboardWrite] };

    app.get("/", readGuard, async (_request, reply) => {
        try {
            return reply.send({ items: await service.catalog() });
        } catch (error) {
            return handleError(error, reply);
        }
    });

    app.get("/:type", readGuard, async (request, reply) => {
        const { type } = request.params as { type: string };
        try {
            return reply.send(await service.list(type));
        } catch (error) {
            return handleError(error, reply);
        }
    });

    app.post("/:type", writeGuard, async (request, reply) => {
        const { type } = request.params as { type: string };
        try {
            const created = await service.create(type, request.body);
            return reply.code(201).send(created);
        } catch (error) {
            return handleError(error, reply);
        }
    });

    app.patch("/:type/:id", writeGuard, async (request: FastifyRequest, reply) => {
        const { type, id } = request.params as { type: string; id: string };
        try {
            return reply.send(await service.update(type, id, request.body));
        } catch (error) {
            return handleError(error, reply);
        }
    });
};

export default referencesRoutes;
