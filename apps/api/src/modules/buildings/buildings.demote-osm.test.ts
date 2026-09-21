import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EntityAdminAreaRepository } from "../entity-admin-area/entity-admin-area.repo.js";
import { EntityAdminAreaService } from "../entity-admin-area/entity-admin-area.service.js";
import type { BuildingsRepository, BuildingDemoteSnapshotRow, OsmBuildingIdentityMatch } from "./buildings.repo.js";
import {
    BuildingDemoteBlockedError,
    BuildingNotFoundError,
    BuildingsService,
} from "./buildings.service.js";

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

const identity: OsmBuildingIdentityMatch = {
    id: "101",
    public_id: "11111111-1111-1111-1111-111111111111",
    external_id: "osm:way:9100000001",
    source_feature_type: "way",
    source_feature_id: "9100000001",
    is_active: true,
    deleted_at: null,
};

function snapshot(): BuildingDemoteSnapshotRow {
    return {
        id: "101",
        public_id: identity.public_id,
        external_id: "osm:way:9100000001",
        class_code: "yes",
        building_type_id: "9",
        admin_area_id: null,
        region_code: null,
        levels: null,
        height_m: null,
        area_m2: 40,
        confidence_score: 80,
        verification_status: "unverified",
        is_verified: false,
        is_active: true,
        deleted_at: null,
        is_geometry_manually_edited: false,
        is_attributes_manually_edited: false,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: null,
        updated_by: null,
        verified_at: null,
        verified_by: null,
        verification_note: null,
        source_registry_id: "1",
        source_snapshot_id: null,
        source_feature_type: "way",
        source_feature_id: "9100000001",
        source_refs: { source: "osm_myanmar" },
        normalized_data: {},
        name: "TEST_CORE",
        geometry,
        centroid: null,
    };
}

function makeService(repo: Partial<BuildingsRepository>) {
    const entityAdminAreaRepo = {
        isTownshipAdminArea: async () => true,
        getActiveAdminAreaSummary: async () => null,
        findContainingTownshipId: async () => null,
        inferAdminAreaIdForPolygonGeoJson: async () => null,
    } as unknown as EntityAdminAreaRepository;
    return new BuildingsService(repo as BuildingsRepository, new EntityAdminAreaService(entityAdminAreaRepo));
}

describe("BuildingsService demote OSM building", () => {
    const body = { feature_key: "osm:W:9100000001" };

    it("preflight returns snapshot for an active Core identity", async () => {
        const service = makeService({
            findOsmBuildingByIdentity: async () => identity,
            getBuildingDemoteSnapshot: async () => snapshot(),
            listBuildingNamesForDemote: async () => [],
            countPlaceBuildingLinks: async () => 0,
            countOpenBuildingReports: async () => 0,
        });
        const result = await service.preflightDemoteOsmBuilding(body);
        assert.equal(result.feature_key, "osm:way:9100000001");
        assert.equal(result.core_id, "101");
        assert.equal(result.class_code, "yes");
    });

    it("stops when no active Core exists", async () => {
        const service = makeService({
            findOsmBuildingByIdentity: async () => null,
        });
        await assert.rejects(() => service.preflightDemoteOsmBuilding(body), BuildingNotFoundError);
    });

    it("blocks place-building links without deleting", async () => {
        let removed = false;
        const service = makeService({
            findOsmBuildingByIdentity: async () => identity,
            getBuildingDemoteSnapshot: async () => snapshot(),
            countPlaceBuildingLinks: async () => 2,
            countOpenBuildingReports: async () => 0,
            removeActiveBuildingForDemote: async () => {
                removed = true;
                return { id: "101", public_id: identity.public_id };
            },
        });
        await assert.rejects(() => service.preflightDemoteOsmBuilding(body), BuildingDemoteBlockedError);
        await assert.rejects(() => service.removeDemotedOsmBuilding(body, testUser), BuildingDemoteBlockedError);
        assert.equal(removed, false);
    });

    it("hard-removes Core after a clean preflight", async () => {
        let removed = 0;
        const service = makeService({
            findOsmBuildingByIdentity: async () => identity,
            getBuildingDemoteSnapshot: async () => snapshot(),
            listBuildingNamesForDemote: async () => [],
            countPlaceBuildingLinks: async () => 0,
            countOpenBuildingReports: async () => 0,
            removeActiveBuildingForDemote: async (args) => {
                removed += 1;
                assert.equal(args.publicId, identity.public_id);
                assert.equal(args.before.feature_key, "osm:way:9100000001");
                return { id: "101", public_id: identity.public_id };
            },
        });
        const result = await service.removeDemotedOsmBuilding(body, testUser);
        assert.equal(removed, 1);
        assert.equal(result.removed, true);
        assert.equal(result.core_id, "101");
    });
});
