import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EntityAdminAreaRepository } from "../entity-admin-area/entity-admin-area.repo.js";
import { EntityAdminAreaService } from "../entity-admin-area/entity-admin-area.service.js";
import type { BuildingsRepository, BuildingDetailRow, OsmBuildingIdentityMatch } from "./buildings.repo.js";
import { BuildingSuppressedError, BuildingsService } from "./buildings.service.js";

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

const testUser = { sub: "1", id: "1", email: "admin@test", roles: ["admin"] as string[] };

function detail(id: string): BuildingDetailRow {
    return {
        id,
        public_id: "11111111-1111-1111-1111-111111111111",
        external_id: "osm:way:9100000001",
        name_mm: null,
        name_en: null,
        fallback_name: null,
        class_code: "unknown",
        building_type_id: "9",
        ref_bt_id: "9",
        ref_bt_code: "unknown",
        ref_bt_name: "Unknown",
        ref_bt_name_mm: null,
        ref_bt_parent_id: null,
        building_type_code: "unknown",
        building_type_name: "Unknown",
        building_type_name_mm: null,
        admin_area_id: null,
        admin_area_row_id: null,
        admin_area_canonical_name: null,
        admin_area_slug: null,
        normalized_data: {},
        source_refs: { source: "osm_myanmar" },
        levels: null,
        height_m: null,
        area_m2: 40,
        confidence_score: 80,
        verification_status: "unverified",
        is_verified: false,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
        geometry,
    };
}

function makeService(repo: Partial<BuildingsRepository>) {
    const entityAdminAreaRepo = {
        isTownshipAdminArea: async () => true,
        getActiveAdminAreaSummary: async () => null,
        findContainingTownshipId: async () => null,
        inferAdminAreaIdForPolygonGeoJson: async () => null,
    } as unknown as EntityAdminAreaRepository;
    return new BuildingsService(
        {
            findBuildingRenderSuppression: async () => null,
            ...repo,
        } as BuildingsRepository,
        new EntityAdminAreaService(entityAdminAreaRepo),
    );
}

describe("BuildingsService.promoteOsmBuilding", () => {
    const body = {
        feature_key: "osm:W:9100000001",
        local_source: "base" as const,
        geometry,
        class_code: "yes",
    };

    it("creates when identity is new", async () => {
        let created = 0;
        const createdRow = detail("11");
        const service = makeService({
            analyzeBuildingGeometry: async () => ({
                allowed_type: true,
                is_valid: true,
                invalid_reason: null,
                area_m2: 50,
            }),
            findOsmBuildingByIdentity: async () => null,
            findBuildingTypeByCode: async () => ({ id: 9n, code: "unknown" }),
            createPromotedOsmBuilding: async () => {
                created += 1;
                return createdRow;
            },
            tryInferDashboardBuildingAdminAreaFromGeometry: async () => undefined,
        });

        const result = await service.promoteOsmBuilding(body, testUser);
        assert.equal(result.operation, "created");
        assert.equal(result.core_id, "11");
        assert.equal(result.feature_key, "osm:way:9100000001");
        assert.equal(created, 1);
    });

    it("returns existing for a second base promote (no duplicate)", async () => {
        const existing: OsmBuildingIdentityMatch = {
            id: "11",
            public_id: "11111111-1111-1111-1111-111111111111",
            external_id: "osm:W:9100000001",
            source_feature_type: "way",
            source_feature_id: "9100000001",
            is_active: true,
            deleted_at: null,
        };
        let created = 0;
        let updated = 0;
        const service = makeService({
            analyzeBuildingGeometry: async () => ({
                allowed_type: true,
                is_valid: true,
                invalid_reason: null,
                area_m2: 50,
            }),
            findOsmBuildingByIdentity: async () => existing,
            getActiveBuildingByPublicId: async () => detail("11"),
            findBuildingTypeByCode: async () => ({ id: 9n, code: "unknown" }),
            createPromotedOsmBuilding: async () => {
                created += 1;
                return detail("11");
            },
            updatePromotedOsmBuilding: async () => {
                updated += 1;
                return detail("11");
            },
        });

        const result = await service.promoteOsmBuilding(body, testUser);
        assert.equal(result.operation, "existing");
        assert.equal(created, 0);
        assert.equal(updated, 0);
    });

    it("updates from archive instead of inserting", async () => {
        const existing: OsmBuildingIdentityMatch = {
            id: "11",
            public_id: "11111111-1111-1111-1111-111111111111",
            external_id: "osm:way:9100000001",
            source_feature_type: "way",
            source_feature_id: "9100000001",
            is_active: true,
            deleted_at: null,
        };
        let updated = 0;
        const service = makeService({
            analyzeBuildingGeometry: async () => ({
                allowed_type: true,
                is_valid: true,
                invalid_reason: null,
                area_m2: 50,
            }),
            findOsmBuildingByIdentity: async () => existing,
            findBuildingTypeByCode: async () => ({ id: 9n, code: "unknown" }),
            updatePromotedOsmBuilding: async () => {
                updated += 1;
                return detail("11");
            },
        });

        const result = await service.promoteOsmBuilding({ ...body, local_source: "archive" }, testUser);
        assert.equal(result.operation, "updated");
        assert.equal(updated, 1);
    });

    it("refuses a suppressed Core row", async () => {
        const service = makeService({
            analyzeBuildingGeometry: async () => ({
                allowed_type: true,
                is_valid: true,
                invalid_reason: null,
                area_m2: 50,
            }),
            findOsmBuildingByIdentity: async () => ({
                id: "11",
                public_id: "11111111-1111-1111-1111-111111111111",
                external_id: "osm:way:9100000001",
                source_feature_type: "way",
                source_feature_id: "9100000001",
                is_active: false,
                deleted_at: new Date(),
            }),
            findBuildingTypeByCode: async () => ({ id: 9n, code: "unknown" }),
        });

        await assert.rejects(() => service.promoteOsmBuilding(body, testUser), BuildingSuppressedError);
    });
});
