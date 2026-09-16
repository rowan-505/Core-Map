import { parseBuildingOsmFeatureKey } from "../../../lib/osm/building-osm-feature-key.js";
import {
    CoreReviewSuppressedError,
    CoreReviewValidationError,
} from "../core-review-write.errors.js";
import type { PromoteOsmLandAreaBody } from "./land-areas-promote.schema.js";
import {
    CoreReviewLandAreasRepository,
    serializeCoreReviewLandArea,
} from "./land-areas.repo.js";

export class LandAreasPromoteService {
    constructor(private readonly landAreasRepo: CoreReviewLandAreasRepository) {}

    async promoteOsmLandArea(body: PromoteOsmLandAreaBody) {
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

        const geojsonText = await this.landAreasRepo.assertPromotablePolygon(body.geometry);
        const landClass = await this.landAreasRepo.resolveActiveLandAreaClass(body.class_code);
        if (!landClass) {
            throw new CoreReviewValidationError("Unknown land area class", [
                {
                    path: "class_code",
                    message: "class_code must match an active ref.ref_land_area_classes.code",
                },
            ]);
        }
        const landAreaClassId = landClass.id;
        const cropCode = landClass.code === "paddy" || landClass.code === "rice" ? "rice" : null;

        const existing = await this.landAreasRepo.findOsmLandAreaByIdentity({
            sourceFeatureType: identity.sourceFeatureType,
            sourceFeatureId: identity.sourceFeatureId,
            featureKey: identity.featureKey,
        });

        const renderSuppression = await this.landAreasRepo.findLandAreaRenderSuppression(identity.featureKey);
        if (renderSuppression) {
            throw new CoreReviewSuppressedError(
                "This land area is render-suppressed (DELETE). Clear the suppression before promoting.",
            );
        }

        if (existing?.deleted_at || existing?.is_active === false) {
            throw new CoreReviewSuppressedError(
                "This land area already exists in Core but is deleted or inactive. Restore it instead of promoting again."
            );
        }

        const nameSlots = {
            name_und: body.name ?? null,
            name_mm: body.name_mm ?? null,
            name_en: body.name_en ?? null,
        };
        const sourceRefs = {
            source: "osm_myanmar",
            osm_feature_type: identity.sourceFeatureType,
            osm_id: identity.sourceFeatureId.toString(),
            promotion: {
                feature_key: identity.featureKey,
                local_source: body.local_source,
            },
        };

        if (existing) {
            if (body.local_source === "base") {
                const row = await this.landAreasRepo.getLandAreaById(existing.public_id);
                if (!row) {
                    throw new CoreReviewValidationError("Land area could not be loaded", [
                        { path: "feature_key", message: "Matched Core row could not be loaded" },
                    ]);
                }
                return this.wrap(identity.featureKey, body.local_source, "existing", row);
            }

            const updated = await this.landAreasRepo.updatePromotedOsmLandArea({
                publicId: existing.public_id,
                geojsonText,
                landAreaClassId,
                classCode: landClass.code,
                nameSlots,
                featureKey: identity.featureKey,
                sourceFeatureType: identity.sourceFeatureType,
                sourceFeatureId: identity.sourceFeatureId,
                sourceRefs,
                cropCode,
            });
            if (!updated) {
                throw new CoreReviewValidationError("Land area geometry update failed validation", [
                    { path: "geometry", message: "Geometry must be a valid non-empty Polygon or MultiPolygon." },
                ]);
            }
            return this.wrap(identity.featureKey, body.local_source, "updated", updated);
        }

        try {
            const created = await this.landAreasRepo.createPromotedOsmLandArea({
                geojsonText,
                landAreaClassId,
                classCode: landClass.code,
                nameSlots,
                featureKey: identity.featureKey,
                sourceFeatureType: identity.sourceFeatureType,
                sourceFeatureId: identity.sourceFeatureId,
                sourceRefs,
                cropCode,
            });
            if (!created) {
                throw new CoreReviewValidationError("Land area could not be saved", [
                    { path: "geometry", message: "Geometry must be a valid non-empty Polygon or MultiPolygon." },
                ]);
            }
            return this.wrap(identity.featureKey, body.local_source, "created", created);
        } catch (error) {
            const raced = await this.landAreasRepo.findOsmLandAreaByIdentity({
                sourceFeatureType: identity.sourceFeatureType,
                sourceFeatureId: identity.sourceFeatureId,
                featureKey: identity.featureKey,
            });
            if (raced && !raced.deleted_at && raced.is_active !== false) {
                const row = await this.landAreasRepo.getLandAreaById(raced.public_id);
                if (row) {
                    return this.wrap(identity.featureKey, body.local_source, "existing", row);
                }
            }
            throw error;
        }
    }

    private wrap(
        featureKey: string,
        localSource: "archive" | "base",
        operation: "created" | "existing" | "updated",
        row: Parameters<typeof serializeCoreReviewLandArea>[0]
    ) {
        return {
            feature_key: featureKey,
            local_source: localSource,
            operation,
            core_id: row.id,
            public_id: row.public_id,
            land_area: serializeCoreReviewLandArea(row),
        };
    }
}
