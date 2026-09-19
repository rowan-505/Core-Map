import type { FastifyPluginAsync, FastifyReply } from "fastify";

import { FoodRankingError } from "./food-ranking.errors.js";
import {
    listAdminFoodDrinkRecommendationsQuerySchema,
    listFoodDrinkRecommendationsQuerySchema,
} from "./food-ranking.schema.js";
import { FoodRankingService } from "./food-ranking.service.js";
import {
    getAdminFoodDrinkRecommendationsSchema,
    getFoodDrinkRecommendationsSchema,
} from "./food-ranking.openapi.js";

function handleFoodRankingError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof FoodRankingError) {
        return reply.code(error.statusCode).send({
            message: error.message,
            ...(error.code ? { code: error.code } : {}),
        });
    }
    throw error;
}

export type FoodRankingRoutesOptions = {
    service?: FoodRankingService;
};

/**
 * Food & Drink Township Recommendations V1.
 * Separate from Tourism Ranking.
 */
const foodRankingRoutes: FastifyPluginAsync<FoodRankingRoutesOptions> = async (app, opts) => {
    const service = opts.service ?? FoodRankingService.create(app.prisma);
    const adminGuard = {
        preHandler: [app.authenticate, app.requireRole("admin", "super_admin")],
    };

    app.get(
        "/food-drink/recommendations",
        { schema: getFoodDrinkRecommendationsSchema },
        async (request, reply) => {
            const query = listFoodDrinkRecommendationsQuerySchema.safeParse(request.query);
            if (!query.success) {
                return reply.code(400).send({
                    message: "Invalid food & drink recommendations query",
                    issues: query.error.flatten(),
                });
            }
            try {
                return reply.send(await service.listRecommendations(query.data));
            } catch (error) {
                return handleFoodRankingError(error, reply);
            }
        }
    );

    app.get(
        "/admin/food-drink/recommendations",
        { ...adminGuard, schema: getAdminFoodDrinkRecommendationsSchema },
        async (request, reply) => {
            const query = listAdminFoodDrinkRecommendationsQuerySchema.safeParse(request.query);
            if (!query.success) {
                return reply.code(400).send({
                    message: "Invalid admin food & drink recommendations query",
                    issues: query.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await service.listRecommendations({
                        ...query.data,
                        include_breakdown: true,
                    })
                );
            } catch (error) {
                return handleFoodRankingError(error, reply);
            }
        }
    );
};

export default foodRankingRoutes;
