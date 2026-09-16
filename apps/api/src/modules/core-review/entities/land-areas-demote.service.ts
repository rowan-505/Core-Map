import type { JwtUser } from "../../../plugins/auth.js";
import { parseBuildingOsmFeatureKey } from "../../../lib/osm/building-osm-feature-key.js";
import {
    CoreReviewDemoteBlockedError,
    CoreReviewNotFoundError,
    CoreReviewValidationError,
    type CoreReviewDemoteDependency,
} from "../core-review-write.errors.js";
import type { DemoteOsmLandAreaBody } from "./land-areas-promote.schema.js";
import type {
    CoreReviewLandAreasRepository,
    LandAreaDemoteNameRow,
    LandAreaDemoteSnapshotRow,
} from "./land-areas.repo.js";

function editorIdFromJwt(user: JwtUser): bigint | null {
    const raw = user.id?.trim();
    return raw && /^\d+$/.test(raw) ? BigInt(raw) : null;
}

export class LandAreasDemoteService {
    constructor(private readonly landAreasRepo: CoreReviewLandAreasRepository) {}

    async preflightDemoteOsmLandArea(body: DemoteOsmLandAreaBody) {
        return this.prepareDemotePayload(body.feature_key);
    }

    async removeDemotedOsmLandArea(body: DemoteOsmLandAreaBody, user: JwtUser) {
        const prepared = await this.prepareDemotePayload(body.feature_key);
        try {
            const removed = await this.landAreasRepo.removeActiveLandAreaForDemote({
                publicId: prepared.public_id,
                actorUserId: editorIdFromJwt(user),
                before: prepared.core_snapshot,
            });
            if (!removed) {
                throw new CoreReviewNotFoundError("No active Core land area for this feature_key");
            }
            return {
                feature_key: prepared.feature_key,
                core_id: removed.id,
                public_id: removed.public_id,
                removed: true,
            };
        } catch (error) {
            if (error instanceof CoreReviewNotFoundError || error instanceof CoreReviewDemoteBlockedError) {
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            if (/23503|foreign key/i.test(message)) {
                throw new CoreReviewDemoteBlockedError(
                    "Core land area could not be removed because a database relationship still references it.",
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
    }

    private async prepareDemotePayload(rawFeatureKey: string) {
        const identity = parseBuildingOsmFeatureKey(rawFeatureKey);
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

        if (!existing || existing.deleted_at || existing.is_active === false) {
            throw new CoreReviewNotFoundError("No active Core land area for this feature_key");
        }

        const row = await this.landAreasRepo.getLandAreaDemoteSnapshot(existing.public_id);
        if (!row) {
            throw new CoreReviewNotFoundError("No active Core land area for this feature_key");
        }

        const dependencies = await this.collectDemoteDependencies(row);
        if (dependencies.length > 0) {
            throw new CoreReviewDemoteBlockedError(
                "Demotion is blocked because removing this Core land area would break protected relationships.",
                dependencies,
            );
        }

        const names = await this.landAreasRepo.listLandAreaNamesForDemote(BigInt(row.id));
        const nameMm =
            names.find((n) => n.language_code === "my" || n.language_code === "mm")?.name ?? null;
        const nameEn = names.find((n) => n.language_code === "en")?.name ?? null;
        const nameUnd = names.find((n) => n.language_code === "und")?.name ?? row.name;

        return {
            feature_key: identity.featureKey,
            core_id: row.id,
            public_id: row.public_id,
            class_code: row.class_code ?? "",
            name: nameUnd,
            name_mm: nameMm,
            name_en: nameEn,
            geometry: row.geometry,
            core_snapshot: this.buildDemoteCoreSnapshot(row, names, identity.featureKey),
        };
    }

    private async collectDemoteDependencies(
        row: LandAreaDemoteSnapshotRow,
    ): Promise<CoreReviewDemoteDependency[]> {
        const dependencies: CoreReviewDemoteDependency[] = [];
        const geom = row.geometry;
        if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) {
            dependencies.push({
                code: "invalid_geometry",
                count: 1,
                message: "Core geometry is missing or is not a polygon.",
            });
        }
        if (!row.class_code?.trim() || !row.land_area_class_id) {
            dependencies.push({
                code: "missing_land_class",
                count: 1,
                message: "Core land_area_class_id / class_code is required to restore this feature later.",
            });
        }
        if (!row.detail_level?.trim()) {
            dependencies.push({
                code: "missing_detail_level",
                count: 1,
                message: "Core detail_level is required to restore this feature later.",
            });
        }

        const landAreaId = BigInt(row.id);
        const importReviewLinks = await this.landAreasRepo.countImportReviewLandAreaLinks(landAreaId);
        if (importReviewLinks > 0) {
            dependencies.push({
                code: "import_review_candidates",
                count: importReviewLinks,
                message: `${importReviewLinks} import-review land candidate(s) still reference this land area.`,
            });
        }

        const openReports = await this.landAreasRepo.countOpenLandAreaReports(landAreaId, row.public_id);
        if (openReports > 0) {
            dependencies.push({
                code: "open_reports",
                count: openReports,
                message: `${openReports} open report(s) still target this land area.`,
            });
        }

        return dependencies;
    }

    private buildDemoteCoreSnapshot(
        row: LandAreaDemoteSnapshotRow,
        names: LandAreaDemoteNameRow[],
        featureKey: string,
    ) {
        return {
            feature_key: featureKey,
            id: row.id,
            public_id: row.public_id,
            external_id: row.external_id,
            name: row.name,
            names,
            class_code: row.class_code,
            land_area_class_id: row.land_area_class_id,
            admin_area_id: row.admin_area_id,
            region_code: row.region_code,
            detail_level: row.detail_level,
            crop_code: row.crop_code,
            irrigated: row.irrigated,
            seasonality: row.seasonality,
            area_m2: row.area_m2,
            centroid: row.centroid,
            geometry: row.geometry,
            confidence_score: row.confidence_score,
            manual_override: row.manual_override,
            verification_status: row.verification_status,
            is_verified: row.is_verified,
            verified_at: row.verified_at,
            verified_by: row.verified_by,
            verification_note: row.verification_note,
            is_active: row.is_active,
            deleted_at: row.deleted_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
            source_registry_id: row.source_registry_id,
            source_snapshot_id: row.source_snapshot_id,
            source_feature_type: row.source_feature_type,
            source_feature_id: row.source_feature_id,
            source_tags: row.source_tags,
            source_refs: row.source_refs,
            normalized_data: row.normalized_data,
        };
    }
}
