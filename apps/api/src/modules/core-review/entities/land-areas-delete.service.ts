import type { JwtUser } from "../../../plugins/auth.js";
import { parseBuildingOsmFeatureKey } from "../../../lib/osm/building-osm-feature-key.js";
import {
    CoreReviewDemoteBlockedError,
    CoreReviewValidationError,
    type CoreReviewDemoteDependency,
} from "../core-review-write.errors.js";
import type {
    ClearLandAreaRenderSuppressionBody,
    DeleteOsmLandAreaBody,
} from "./land-areas-promote.schema.js";
import type { CoreReviewLandAreasRepository } from "./land-areas.repo.js";

function editorIdFromJwt(user: JwtUser): bigint | null {
    const raw = user.id?.trim();
    return raw && /^\d+$/.test(raw) ? BigInt(raw) : null;
}

export class LandAreasDeleteService {
    constructor(private readonly landAreasRepo: CoreReviewLandAreasRepository) {}

    async deleteOsmLandAreaFromTiles(body: DeleteOsmLandAreaBody, user: JwtUser) {
        const identity = parseBuildingOsmFeatureKey(body.feature_key);
        if (!identity) {
            throw new CoreReviewValidationError("Invalid land area feature_key", [
                {
                    path: "feature_key",
                    message:
                        "feature_key must be a canonical land OSM identity (osm:way:<id> or osm:relation:<id>).",
                },
            ]);
        }

        const existing = await this.landAreasRepo.findOsmLandAreaByIdentity({
            sourceFeatureType: identity.sourceFeatureType,
            sourceFeatureId: identity.sourceFeatureId,
            featureKey: identity.featureKey,
        });

        if (existing) {
            const dependencies = await this.collectDeleteDependencies(existing.id, existing.public_id);
            if (dependencies.length > 0) {
                throw new CoreReviewDemoteBlockedError(
                    "Delete is blocked because removing this Core land area would break protected relationships.",
                    dependencies,
                );
            }
            const suppression = await this.landAreasRepo.upsertLandAreaRenderSuppression({
                featureKey: identity.featureKey,
                actorUserId: editorIdFromJwt(user),
            });
            let coreRemoved = false;
            try {
                const removed = await this.landAreasRepo.removeLandAreaForDelete({
                    publicId: existing.public_id,
                    actorUserId: editorIdFromJwt(user),
                    before: { feature_key: identity.featureKey, public_id: existing.public_id },
                });
                coreRemoved = Boolean(removed);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (/23503|foreign key/i.test(message)) {
                    throw new CoreReviewDemoteBlockedError(
                        "Core land area could not be removed because a database relationship still references it. Suppression was written.",
                        [
                            {
                                code: "foreign_key",
                                count: 1,
                                message: "A protected foreign key still points at this Core land area.",
                            },
                        ],
                    );
                }
                throw error;
            }
            return {
                feature_key: identity.featureKey,
                suppressed: true,
                created: suppression.created,
                core_removed: coreRemoved,
            };
        }

        const suppression = await this.landAreasRepo.upsertLandAreaRenderSuppression({
            featureKey: identity.featureKey,
            actorUserId: editorIdFromJwt(user),
        });
        return {
            feature_key: identity.featureKey,
            suppressed: true,
            created: suppression.created,
            core_removed: false,
        };
    }

    async clearLandAreaRenderSuppression(body: ClearLandAreaRenderSuppressionBody) {
        const identity = parseBuildingOsmFeatureKey(body.feature_key);
        if (!identity) {
            throw new CoreReviewValidationError("Invalid land area feature_key", [
                {
                    path: "feature_key",
                    message:
                        "feature_key must be a canonical land OSM identity (osm:way:<id> or osm:relation:<id>).",
                },
            ]);
        }
        const cleared = await this.landAreasRepo.clearLandAreaRenderSuppression(identity.featureKey);
        return { feature_key: identity.featureKey, cleared };
    }

    private async collectDeleteDependencies(
        landAreaIdText: string,
        publicId: string,
    ): Promise<CoreReviewDemoteDependency[]> {
        const dependencies: CoreReviewDemoteDependency[] = [];
        const landAreaId = BigInt(landAreaIdText);
        const openReports = await this.landAreasRepo.countOpenLandAreaReports(landAreaId, publicId);
        if (openReports > 0) {
            dependencies.push({
                code: "open_reports",
                count: openReports,
                message: `${openReports} open report(s) still target this land area.`,
            });
        }
        return dependencies;
    }
}
