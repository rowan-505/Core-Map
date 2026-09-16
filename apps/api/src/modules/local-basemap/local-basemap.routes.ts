import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { BuildingsRepository } from "../buildings/buildings.repo.js";
import { BuildingsService } from "../buildings/buildings.service.js";
import { EntityAdminAreaRepository } from "../entity-admin-area/entity-admin-area.repo.js";
import { EntityAdminAreaService } from "../entity-admin-area/entity-admin-area.service.js";
import { CoreReviewService } from "../core-review/core-review.service.js";
import { isLocalBasemapAdminEnabled, localBasemapDisabledReason } from "./local-basemap.enabled.js";
import { LocalBasemapTileRepository } from "./local-basemap.repo.js";
import {
    localBasemapActionBodySchema,
    localBasemapEntityParamSchema,
    localBasemapFeatureDetailQuerySchema,
    localBasemapFeatureKeyParamsSchema,
    localBasemapSearchQuerySchema,
} from "./local-basemap.schema.js";
import { LocalBasemapService, mapLocalBasemapError } from "./local-basemap.service.js";
import { getLocalTileAdminPool, getLocalTilePool } from "./local-basemap.tile-db.js";
import type { LocalBasemapEntity } from "./local-basemap.types.js";
import {
    isValidTileCoord,
    queryLifecycleMvt,
} from "./local-basemap.mvt.js";
import {
    lifecycleEntityFromLayer,
    localBasemapLifecycleTileParamsSchema,
} from "./local-basemap.mvt.schema.js";

const localBasemapRoutes: FastifyPluginAsync = async (app) => {
    if (!isLocalBasemapAdminEnabled()) {
        app.log.info({ reason: localBasemapDisabledReason() }, "local-basemap routes not registered");
        return;
    }

    const tilePool = getLocalTilePool();
    const adminPool = getLocalTileAdminPool();
    const tileRepo = new LocalBasemapTileRepository(adminPool);
    const buildingsService = new BuildingsService(
        new BuildingsRepository(app.prisma),
        new EntityAdminAreaService(new EntityAdminAreaRepository(app.prisma))
    );
    const coreReviewService = new CoreReviewService(app.prisma);
    const service = new LocalBasemapService(tileRepo, buildingsService, coreReviewService);

    app.get(
        "/status",
        { preHandler: [app.authenticate, app.requireDashboardAccess] },
        async () => ({
            enabled: true,
            environment: "local-dev",
            message: "Local Basemap admin bridge is available.",
        })
    );

    /**
     * Live lifecycle MVT for Dev Map overlays (tile_source.*_v → ST_AsMVT).
     * Registered before /:entity routes so "tiles" is not parsed as an entity.
     * Does not change promote/demote/delete business logic.
     */
    app.get(
        "/tiles/:layer/:z/:x/:y",
        { preHandler: [app.authenticate, app.requireDashboardAccess] },
        async (request, reply) => {
            const params = localBasemapLifecycleTileParamsSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({ message: "Invalid tile request" });
            }
            const { layer, z, x, y } = params.data;
            if (!isValidTileCoord(z, x, y)) {
                return reply.code(400).send({ message: "Tile coordinates out of range" });
            }

            try {
                const entity = lifecycleEntityFromLayer(layer);
                const tile = await queryLifecycleMvt(tilePool, entity, z, x, y);
                reply.header("Content-Type", "application/vnd.mapbox-vector-tile");
                reply.header("Cache-Control", "private, no-store");
                return reply.send(tile);
            } catch (error) {
                request.log.error({ err: error, layer, z, x, y }, "lifecycle MVT tile failed");
                const mapped = mapLocalBasemapError(error);
                return reply.code(mapped.status).send(mapped.body);
            }
        }
    );

    app.get(
        "/:entity/search",
        { preHandler: [app.authenticate, app.requireDashboardAccess] },
        async (request, reply) => {
            const params = localBasemapEntityParamSchema.safeParse(request.params);
            const query = localBasemapSearchQuerySchema.safeParse(request.query);
            if (!params.success || !query.success) {
                return reply.code(400).send({ message: "Invalid search request" });
            }
            const items = await service.search(
                params.data.entity as LocalBasemapEntity,
                query.data.q,
                query.data.limit
            );
            return reply.send({ items });
        }
    );

    app.get(
        "/:entity/features/:featureKey",
        { preHandler: [app.authenticate, app.requireDashboardAccess] },
        async (request, reply) => {
            const params = localBasemapFeatureKeyParamsSchema.safeParse(request.params);
            if (!params.success) {
                return reply.code(400).send({ message: "Invalid feature request" });
            }
            const query = localBasemapFeatureDetailQuerySchema.safeParse(request.query ?? {});
            const includeGeometry = query.success ? Boolean(query.data.includeGeometry) : false;
            const detail = await service.getDetail(
                params.data.entity as LocalBasemapEntity,
                decodeURIComponent(params.data.featureKey),
                { includeGeometry },
            );
            if (!detail) {
                return reply.code(404).send({ message: "Feature not found in local tile_source" });
            }
            return reply.send(detail);
        }
    );

    async function runAction(
        request: FastifyRequest,
        reply: FastifyReply,
        action: "promote" | "demote" | "delete" | "clear_suppression"
    ) {
        const params = localBasemapEntityParamSchema.safeParse(request.params);
        const body = localBasemapActionBodySchema.safeParse(request.body);
        if (!params.success || !body.success) {
            return reply.code(400).send({ message: "Invalid action payload" });
        }
        if (action === "delete" && body.data.confirm !== "DELETE") {
            return reply.code(400).send({
                message: "Delete requires confirm: DELETE because it suppresses Base/Archive.",
            });
        }
        if (action === "clear_suppression" && body.data.confirm !== "CLEAR_SUPPRESSION") {
            return reply.code(400).send({
                message: "Clear suppression requires confirm: CLEAR_SUPPRESSION.",
            });
        }

        try {
            const entity = params.data.entity as LocalBasemapEntity;
            const featureKey = body.data.feature_key;
            let result;
            if (action === "promote") {
                result = await service.promote(entity, featureKey, request.user);
            } else if (action === "demote") {
                result = await service.demote(entity, featureKey, request.user);
            } else if (action === "delete") {
                result = await service.delete(entity, featureKey, request.user);
            } else {
                result = await service.clearSuppression(entity, featureKey);
            }
            // Structured action results (including partial-safe demote) stay 2xx so the
            // dashboard can show ok / sync_stale / Core-still-wins without treating them as transport failures.
            const status = result.sync_stale ? 202 : 200;
            return reply.code(status).send(result);
        } catch (error) {
            const mapped = mapLocalBasemapError(error);
            return reply.code(mapped.status).send(mapped.body);
        }
    }

    app.post(
        "/:entity/promote",
        { preHandler: [app.authenticate, app.requireDashboardWrite] },
        async (request, reply) => runAction(request, reply, "promote")
    );
    app.post(
        "/:entity/demote",
        { preHandler: [app.authenticate, app.requireDashboardWrite] },
        async (request, reply) => runAction(request, reply, "demote")
    );
    app.post(
        "/:entity/delete",
        { preHandler: [app.authenticate, app.requireDashboardWrite] },
        async (request, reply) => runAction(request, reply, "delete")
    );
    app.post(
        "/:entity/clear-suppression",
        { preHandler: [app.authenticate, app.requireDashboardWrite] },
        async (request, reply) => runAction(request, reply, "clear_suppression")
    );
};

export default localBasemapRoutes;
