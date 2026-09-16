import type { JwtUser } from "../../plugins/auth.js";
import {
    BuildingDemoteBlockedError,
    BuildingNotFoundError,
    BuildingSuppressedError,
    BuildingValidationError,
    BuildingsService,
} from "../buildings/buildings.service.js";
import { CoreReviewService } from "../core-review/core-review.service.js";
import {
    CoreReviewDemoteBlockedError,
    CoreReviewNotFoundError,
    CoreReviewSuppressedError,
    CoreReviewValidationError,
} from "../core-review/core-review-write.errors.js";
import { LocalBasemapTileRepository } from "./local-basemap.repo.js";
import { syncLocalTileDatasets } from "./local-basemap.sync.js";
import type {
    LocalBasemapActionResult,
    LocalBasemapEntity,
    LocalBasemapFeatureDetail,
    LocalBasemapSearchHit,
} from "./local-basemap.types.js";

export class LocalBasemapUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "LocalBasemapUnavailableError";
    }
}

export class LocalBasemapService {
    constructor(
        private readonly tileRepo: LocalBasemapTileRepository,
        private readonly buildingsService: BuildingsService,
        private readonly coreReviewService: CoreReviewService,
        private readonly syncFn: typeof syncLocalTileDatasets = syncLocalTileDatasets
    ) {}

    search(entity: LocalBasemapEntity, q: string, limit?: number): Promise<LocalBasemapSearchHit[]> {
        return this.tileRepo.search(entity, q, limit);
    }

    getDetail(
        entity: LocalBasemapEntity,
        featureKey: string,
        options: { includeGeometry?: boolean } = {},
    ): Promise<LocalBasemapFeatureDetail | null> {
        return this.tileRepo.getDetail(entity, featureKey, options);
    }

    async promote(entity: LocalBasemapEntity, featureKey: string, user: JwtUser): Promise<LocalBasemapActionResult> {
        const candidate = await this.tileRepo.lookupPromoteCandidate(entity, featureKey);
        if (!candidate) {
            throw new LocalBasemapUnavailableError("Feature was not found in local Base or Archive.");
        }
        if ("suppressed" in candidate && candidate.suppressed) {
            throw new BuildingSuppressedError(
                "Feature is render-suppressed. Clear suppression before promoting."
            );
        }
        if (!("local_source" in candidate) || !candidate.geometry) {
            throw new LocalBasemapUnavailableError("Local geometry is missing.");
        }

        if (entity === "buildings") {
            await this.buildingsService.promoteOsmBuilding(
                {
                    feature_key: featureKey,
                    local_source: candidate.local_source,
                    geometry: candidate.geometry as {
                        type: "Polygon";
                        coordinates: [number, number][][];
                    } | {
                        type: "MultiPolygon";
                        coordinates: [number, number][][][];
                    },
                    class_code: candidate.class_code ?? undefined,
                    name: candidate.name,
                    name_mm: candidate.name_mm,
                    name_en: candidate.name_en,
                },
                user
            );
            const sync = await this.syncFn(["buildings_core"]);
            const detail = await this.tileRepo.getDetail(entity, featureKey, { includeGeometry: true });
            return {
                feature_key: featureKey,
                operation: "promote",
                ok: true,
                sync_stale: !sync.ok,
                message: sync.ok
                    ? "Promoted to Core."
                    : `Core write succeeded but local buildings_core refresh failed (stale cache): ${sync.detail}`,
                detail,
            };
        }

        if (!candidate.class_code?.trim()) {
            throw new CoreReviewValidationError("Local class_code is required for land promote", [
                { path: "class_code", message: "class_code is required" },
            ]);
        }
        await this.coreReviewService.promoteLandAreaFromSource({
            feature_key: featureKey,
            local_source: candidate.local_source,
            geometry: candidate.geometry as {
                type: "Polygon";
                coordinates: [number, number][][];
            } | {
                type: "MultiPolygon";
                coordinates: [number, number][][][];
            },
            class_code: candidate.class_code,
            name: candidate.name,
            name_mm: candidate.name_mm,
            name_en: candidate.name_en,
        });
        const sync = await this.syncFn(["land_areas_core"]);
        const detail = await this.tileRepo.getDetail(entity, featureKey, { includeGeometry: true });
        return {
            feature_key: featureKey,
            operation: "promote",
            ok: true,
            sync_stale: !sync.ok,
            message: sync.ok
                ? "Promoted to Core."
                : `Core write succeeded but local land_areas_core refresh failed (stale cache): ${sync.detail}`,
            detail,
        };
    }

    async demote(entity: LocalBasemapEntity, featureKey: string, user: JwtUser): Promise<LocalBasemapActionResult> {
        if (entity === "buildings") {
            const prepared = await this.buildingsService.preflightDemoteOsmBuilding({ feature_key: featureKey });
            await this.tileRepo.writeArchiveFromPreflight("buildings", {
                feature_key: prepared.feature_key,
                core_id: String(prepared.core_id),
                public_id: String(prepared.public_id),
                class_code: String(prepared.class_code ?? "yes"),
                name: prepared.name ?? null,
                name_mm: prepared.name_mm ?? null,
                name_en: prepared.name_en ?? null,
                geometry: prepared.geometry as object,
                core_snapshot: prepared.core_snapshot as object,
            });
            try {
                await this.buildingsService.removeDemotedOsmBuilding({ feature_key: featureKey }, user);
            } catch (error) {
                const detail = await this.tileRepo.getDetail(entity, featureKey, { includeGeometry: true });
                const message = error instanceof Error ? error.message : String(error);
                return {
                    feature_key: featureKey,
                    operation: "demote",
                    ok: false,
                    sync_stale: false,
                    message: `Core removal failed; Archive was kept. Core still wins. ${message}`,
                    detail,
                    dependencies:
                        error instanceof BuildingDemoteBlockedError ? error.dependencies : undefined,
                };
            }
            const sync = await this.syncFn(["buildings_core"]);
            const detail = await this.tileRepo.getDetail(entity, featureKey, { includeGeometry: true });
            return {
                feature_key: featureKey,
                operation: "demote",
                ok: true,
                sync_stale: !sync.ok,
                message: sync.ok
                    ? "Demoted to local Archive."
                    : `Core removal succeeded but local buildings_core refresh failed (stale cache): ${sync.detail}`,
                detail,
            };
        }

        const prepared = await this.coreReviewService.preflightDemoteLandAreaFromCore({
            feature_key: featureKey,
        });
        await this.tileRepo.writeArchiveFromPreflight("land", {
            feature_key: prepared.feature_key,
            core_id: String(prepared.core_id),
            public_id: String(prepared.public_id),
            class_code: String(prepared.class_code ?? "unknown"),
            name: prepared.name ?? null,
            name_mm: prepared.name_mm ?? null,
            name_en: prepared.name_en ?? null,
            geometry: prepared.geometry as object,
            core_snapshot: prepared.core_snapshot as object,
        });
        try {
            await this.coreReviewService.removeDemotedLandAreaFromCore({ feature_key: featureKey }, user);
        } catch (error) {
            const detail = await this.tileRepo.getDetail(entity, featureKey, { includeGeometry: true });
            const message = error instanceof Error ? error.message : String(error);
            return {
                feature_key: featureKey,
                operation: "demote",
                ok: false,
                sync_stale: false,
                message: `Core removal failed; Archive was kept. Core still wins. ${message}`,
                detail,
                dependencies:
                    error instanceof CoreReviewDemoteBlockedError ? error.dependencies : undefined,
            };
        }
        const sync = await this.syncFn(["land_areas_core"]);
        const detail = await this.tileRepo.getDetail(entity, featureKey, { includeGeometry: true });
        return {
            feature_key: featureKey,
            operation: "demote",
            ok: true,
            sync_stale: !sync.ok,
            message: sync.ok
                ? "Demoted to local Archive."
                : `Core removal succeeded but local land_areas_core refresh failed (stale cache): ${sync.detail}`,
            detail,
        };
    }

    async delete(entity: LocalBasemapEntity, featureKey: string, user: JwtUser): Promise<LocalBasemapActionResult> {
        if (entity === "buildings") {
            await this.buildingsService.deleteOsmBuildingFromTiles(
                { feature_key: featureKey, confirm: "DELETE" },
                user
            );
            const sync = await this.syncFn(["buildings_suppressed", "buildings_core"]);
            const detail = await this.tileRepo.getDetail(entity, featureKey, { includeGeometry: true });
            return {
                feature_key: featureKey,
                operation: "delete",
                ok: true,
                sync_stale: !sync.ok,
                message: sync.ok
                    ? "Deleted (render-suppressed)."
                    : `Suppression was written but local refresh failed (stale cache): ${sync.detail}`,
                detail,
            };
        }

        await this.coreReviewService.deleteLandAreaFromSource(
            { feature_key: featureKey, confirm: "DELETE" },
            user
        );
        const sync = await this.syncFn(["land_areas_suppressed", "land_areas_core"]);
        const detail = await this.tileRepo.getDetail(entity, featureKey, { includeGeometry: true });
        return {
            feature_key: featureKey,
            operation: "delete",
            ok: true,
            sync_stale: !sync.ok,
            message: sync.ok
                ? "Deleted (render-suppressed)."
                : `Suppression was written but local refresh failed (stale cache): ${sync.detail}`,
            detail,
        };
    }

    async clearSuppression(
        entity: LocalBasemapEntity,
        featureKey: string
    ): Promise<LocalBasemapActionResult> {
        if (entity === "buildings") {
            await this.buildingsService.clearBuildingRenderSuppression({
                feature_key: featureKey,
                confirm: "CLEAR_SUPPRESSION",
            });
            const sync = await this.syncFn(["buildings_suppressed"]);
            const detail = await this.tileRepo.getDetail(entity, featureKey, { includeGeometry: true });
            return {
                feature_key: featureKey,
                operation: "clear_suppression",
                ok: true,
                sync_stale: !sync.ok,
                message: sync.ok
                    ? "Render suppression cleared."
                    : `Suppression cleared but local refresh failed (stale cache): ${sync.detail}`,
                detail,
            };
        }

        await this.coreReviewService.clearLandAreaRenderSuppression({
            feature_key: featureKey,
            confirm: "CLEAR_SUPPRESSION",
        });
        const sync = await this.syncFn(["land_areas_suppressed"]);
        const detail = await this.tileRepo.getDetail(entity, featureKey, { includeGeometry: true });
        return {
            feature_key: featureKey,
            operation: "clear_suppression",
            ok: true,
            sync_stale: !sync.ok,
            message: sync.ok
                ? "Render suppression cleared."
                : `Suppression cleared but local refresh failed (stale cache): ${sync.detail}`,
            detail,
        };
    }
}

export function mapLocalBasemapError(error: unknown): {
    status: number;
    body: Record<string, unknown>;
} {
    if (error instanceof BuildingDemoteBlockedError || error instanceof CoreReviewDemoteBlockedError) {
        return {
            status: 409,
            body: {
                ok: false,
                message: error.message,
                dependencies: error.dependencies,
            },
        };
    }
    if (error instanceof BuildingSuppressedError || error instanceof CoreReviewSuppressedError) {
        return { status: 409, body: { ok: false, message: error.message } };
    }
    if (error instanceof BuildingNotFoundError || error instanceof CoreReviewNotFoundError) {
        return { status: 404, body: { ok: false, message: error.message } };
    }
    if (error instanceof BuildingValidationError || error instanceof CoreReviewValidationError) {
        return {
            status: 400,
            body: { ok: false, message: error.message, issues: error.issues },
        };
    }
    if (error instanceof LocalBasemapUnavailableError) {
        return { status: 404, body: { ok: false, message: error.message } };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { status: 500, body: { ok: false, message } };
}
