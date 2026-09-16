import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CoreReviewSuppressedError } from "../core-review-write.errors.js";
import { LandAreasPromoteService } from "./land-areas-promote.service.js";
import type { CoreReviewLandAreaRow, CoreReviewLandAreasRepository } from "./land-areas.repo.js";

const geometry = {
    type: "Polygon" as const,
    coordinates: [
        [
            [96.1, 16.8],
            [96.2, 16.8],
            [96.2, 16.9],
            [96.1, 16.9],
            [96.1, 16.8],
        ],
    ] as [number, number][][],
};

function detail(id: string): CoreReviewLandAreaRow {
    return {
        id,
        public_id: "22222222-2222-2222-2222-222222222222",
        external_id: "osm:way:9200000001",
        name: "LAND_A_BASE",
        name_mm: null,
        name_en: null,
        name_und: "LAND_A_BASE",
        class_code: "residential",
        land_area_class_id: "3",
        land_area_class_code: "residential",
        land_area_class_name_en: "Residential",
        land_area_class_name_mm: null,
        admin_area_id: null,
        admin_area_name: null,
        detail_level: "zone",
        crop_code: null,
        irrigated: null,
        seasonality: null,
        area_m2: 1200,
        confidence_score: 80,
        manual_override: false,
        verification_status: "unverified",
        is_verified: false,
        is_active: true,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        geometry,
        centroid: null,
        source_tags: {},
        normalized_data: { class_code: "residential" },
        source_refs: { source: "osm_myanmar" },
    };
}

function makeService(repo: Partial<CoreReviewLandAreasRepository>) {
    return new LandAreasPromoteService({
        findLandAreaRenderSuppression: async () => null,
        ...repo,
    } as CoreReviewLandAreasRepository);
}

describe("LandAreasPromoteService.promoteOsmLandArea", () => {
    const body = {
        feature_key: "osm:W:9200000001",
        local_source: "base" as const,
        geometry,
        class_code: "residential",
    };

    it("creates when identity is new", async () => {
        let created = 0;
        const service = makeService({
            assertPromotablePolygon: async () => JSON.stringify(geometry),
            resolveActiveLandAreaClass: async () => ({ id: 3n, code: "residential" }),
            findOsmLandAreaByIdentity: async () => null,
            createPromotedOsmLandArea: async (args) => {
                created += 1;
                assert.equal(args.classCode, "residential");
                return detail("21");
            },
        });

        const result = await service.promoteOsmLandArea(body);
        assert.equal(result.operation, "created");
        assert.equal(result.core_id, "21");
        assert.equal(result.feature_key, "osm:way:9200000001");
        assert.equal(created, 1);
        assert.equal(result.land_area.landAreaClassCode, "residential");
    });

    it("returns existing for a second base promote (no duplicate)", async () => {
        let created = 0;
        let updated = 0;
        const service = makeService({
            assertPromotablePolygon: async () => JSON.stringify(geometry),
            resolveActiveLandAreaClass: async () => ({ id: 3n, code: "residential" }),
            findOsmLandAreaByIdentity: async () => ({
                id: "21",
                public_id: "22222222-2222-2222-2222-222222222222",
                external_id: "osm:W:9200000001",
                source_feature_type: "way",
                source_feature_id: "9200000001",
                is_active: true,
                deleted_at: null,
            }),
            getLandAreaById: async () => detail("21"),
            createPromotedOsmLandArea: async () => {
                created += 1;
                return detail("21");
            },
            updatePromotedOsmLandArea: async () => {
                updated += 1;
                return detail("21");
            },
        });

        const result = await service.promoteOsmLandArea(body);
        assert.equal(result.operation, "existing");
        assert.equal(created, 0);
        assert.equal(updated, 0);
    });

    it("updates from archive instead of inserting", async () => {
        let updated = 0;
        const service = makeService({
            assertPromotablePolygon: async () => JSON.stringify(geometry),
            resolveActiveLandAreaClass: async () => ({ id: 8n, code: "forest" }),
            findOsmLandAreaByIdentity: async () => ({
                id: "21",
                public_id: "22222222-2222-2222-2222-222222222222",
                external_id: "osm:way:9200000001",
                source_feature_type: "way",
                source_feature_id: "9200000001",
                is_active: true,
                deleted_at: null,
            }),
            updatePromotedOsmLandArea: async (args) => {
                updated += 1;
                assert.equal(args.classCode, "forest");
                return detail("21");
            },
        });

        const result = await service.promoteOsmLandArea({ ...body, local_source: "archive", class_code: "forest" });
        assert.equal(result.operation, "updated");
        assert.equal(updated, 1);
    });

    it("refuses a suppressed Core row", async () => {
        const service = makeService({
            assertPromotablePolygon: async () => JSON.stringify(geometry),
            resolveActiveLandAreaClass: async () => ({ id: 3n, code: "residential" }),
            findOsmLandAreaByIdentity: async () => ({
                id: "21",
                public_id: "22222222-2222-2222-2222-222222222222",
                external_id: "osm:way:9200000001",
                source_feature_type: "way",
                source_feature_id: "9200000001",
                is_active: false,
                deleted_at: new Date(),
            }),
        });

        await assert.rejects(() => service.promoteOsmLandArea(body), CoreReviewSuppressedError);
    });

    it("rejects unknown land class codes", async () => {
        const service = makeService({
            assertPromotablePolygon: async () => JSON.stringify(geometry),
            resolveActiveLandAreaClass: async () => null,
            findOsmLandAreaByIdentity: async () => null,
        });

        await assert.rejects(() => service.promoteOsmLandArea(body), /Unknown land area class/);
    });
});
