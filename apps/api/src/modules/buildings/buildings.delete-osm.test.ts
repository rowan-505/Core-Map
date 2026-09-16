import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EntityAdminAreaRepository } from "../entity-admin-area/entity-admin-area.repo.js";
import { EntityAdminAreaService } from "../entity-admin-area/entity-admin-area.service.js";
import type { BuildingsRepository, OsmBuildingIdentityMatch } from "./buildings.repo.js";
import {
    BuildingDemoteBlockedError,
    BuildingSuppressedError,
    BuildingsService,
} from "./buildings.service.js";

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

describe("BuildingsService DELETE OSM building", () => {
    const body = { feature_key: "osm:W:9100000001", confirm: "DELETE" as const };

    it("writes suppression without Core and is idempotent", async () => {
        let upserts = 0;
        const service = makeService({
            findOsmBuildingByIdentity: async () => null,
            upsertBuildingRenderSuppression: async () => {
                upserts += 1;
                return { feature_key: "osm:way:9100000001", created: upserts === 1 };
            },
        });
        const first = await service.deleteOsmBuildingFromTiles(body, testUser);
        const second = await service.deleteOsmBuildingFromTiles(body, testUser);
        assert.equal(first.suppressed, true);
        assert.equal(first.created, true);
        assert.equal(first.core_removed, false);
        assert.equal(second.created, false);
        assert.equal(upserts, 2);
    });

    it("blocks place-building links before writing suppression", async () => {
        let upserts = 0;
        const service = makeService({
            findOsmBuildingByIdentity: async () => identity,
            getBuildingDemoteSnapshot: async () => null,
            countPlaceBuildingLinks: async () => 1,
            countMatchedAddressCandidates: async () => 0,
            countOpenBuildingReports: async () => 0,
            upsertBuildingRenderSuppression: async () => {
                upserts += 1;
                return { feature_key: "osm:way:9100000001", created: true };
            },
        });
        await assert.rejects(() => service.deleteOsmBuildingFromTiles(body, testUser), BuildingDemoteBlockedError);
        assert.equal(upserts, 0);
    });

    it("removes Core after suppression when dependencies are clear", async () => {
        let removed = 0;
        const service = makeService({
            findOsmBuildingByIdentity: async () => identity,
            getBuildingDemoteSnapshot: async () => null,
            countPlaceBuildingLinks: async () => 0,
            countMatchedAddressCandidates: async () => 0,
            countOpenBuildingReports: async () => 0,
            upsertBuildingRenderSuppression: async () => ({ feature_key: "osm:way:9100000001", created: true }),
            removeBuildingForDelete: async () => {
                removed += 1;
                return { id: "101", public_id: identity.public_id };
            },
        });
        const result = await service.deleteOsmBuildingFromTiles(body, testUser);
        assert.equal(result.core_removed, true);
        assert.equal(removed, 1);
    });

    it("reports suppression was written when Core removal hits a foreign key", async () => {
        let upserts = 0;
        const service = makeService({
            findOsmBuildingByIdentity: async () => identity,
            getBuildingDemoteSnapshot: async () => null,
            countPlaceBuildingLinks: async () => 0,
            countMatchedAddressCandidates: async () => 0,
            countOpenBuildingReports: async () => 0,
            upsertBuildingRenderSuppression: async () => {
                upserts += 1;
                return { feature_key: "osm:way:9100000001", created: true };
            },
            removeBuildingForDelete: async () => {
                throw new Error("insert or update on table violates foreign key constraint 23503");
            },
        });
        await assert.rejects(
            () => service.deleteOsmBuildingFromTiles(body, testUser),
            (error: unknown) =>
                error instanceof BuildingDemoteBlockedError &&
                /Suppression was written/i.test(error.message),
        );
        assert.equal(upserts, 1);
    });

    it("blocks promote until suppression is cleared", async () => {
        const blocked = makeService({
            findBuildingRenderSuppression: async () => ({ feature_key: "osm:way:9100000001" }),
            analyzeBuildingGeometry: async () => ({
                allowed_type: true,
                is_valid: true,
                invalid_reason: null,
                area_m2: 50,
            }),
        });
        await assert.rejects(
            () =>
                blocked.promoteOsmBuilding(
                    {
                        feature_key: "osm:way:9100000001",
                        local_source: "base",
                        geometry: {
                            type: "Polygon",
                            coordinates: [
                                [
                                    [96.1, 16.8],
                                    [96.2, 16.8],
                                    [96.2, 16.9],
                                    [96.1, 16.9],
                                    [96.1, 16.8],
                                ],
                            ],
                        },
                        class_code: "yes",
                    },
                    testUser,
                ),
            BuildingSuppressedError,
        );

        let cleared = false;
        const service = makeService({
            clearBuildingRenderSuppression: async () => {
                cleared = true;
                return true;
            },
        });
        const result = await service.clearBuildingRenderSuppression({
            feature_key: "osm:way:9100000001",
            confirm: "CLEAR_SUPPRESSION",
        });
        assert.equal(result.cleared, true);
        assert.equal(cleared, true);
    });
});
