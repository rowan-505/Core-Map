import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CoreReviewDemoteBlockedError, CoreReviewSuppressedError } from "../core-review-write.errors.js";
import { LandAreasDeleteService } from "./land-areas-delete.service.js";
import { LandAreasPromoteService } from "./land-areas-promote.service.js";
import type { CoreReviewLandAreasRepository } from "./land-areas.repo.js";

const testUser = { sub: "1", id: "1", email: "admin@test", roles: ["admin"] as string[] };
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

const identity = {
    id: "21",
    public_id: "22222222-2222-2222-2222-222222222222",
    external_id: "osm:way:9200000001",
    source_feature_type: "way",
    source_feature_id: "9200000001",
    is_active: true,
    deleted_at: null,
};

describe("LandAreasDeleteService", () => {
    const body = { feature_key: "osm:W:9200000001", confirm: "DELETE" as const };

    it("writes suppression without Core and is idempotent", async () => {
        let upserts = 0;
        const service = new LandAreasDeleteService({
            findOsmLandAreaByIdentity: async () => null,
            upsertLandAreaRenderSuppression: async () => {
                upserts += 1;
                return { feature_key: "osm:way:9200000001", created: upserts === 1 };
            },
        } as unknown as CoreReviewLandAreasRepository);
        const first = await service.deleteOsmLandAreaFromTiles(body, testUser);
        const second = await service.deleteOsmLandAreaFromTiles(body, testUser);
        assert.equal(first.created, true);
        assert.equal(second.created, false);
        assert.equal(first.core_removed, false);
    });

    it("blocks import-review links before writing suppression", async () => {
        let upserts = 0;
        const service = new LandAreasDeleteService({
            findOsmLandAreaByIdentity: async () => identity,
            countImportReviewLandAreaLinks: async () => 2,
            countOpenLandAreaReports: async () => 0,
            upsertLandAreaRenderSuppression: async () => {
                upserts += 1;
                return { feature_key: "osm:way:9200000001", created: true };
            },
        } as unknown as CoreReviewLandAreasRepository);
        await assert.rejects(() => service.deleteOsmLandAreaFromTiles(body, testUser), CoreReviewDemoteBlockedError);
        assert.equal(upserts, 0);
    });
});

describe("LandAreasPromoteService after DELETE", () => {
    it("blocks promote while suppression exists and allows it after clear", async () => {
        const promote = new LandAreasPromoteService({
            assertPromotablePolygon: async () => JSON.stringify(geometry),
            resolveActiveLandAreaClass: async () => ({ id: 3n, code: "residential" }),
            findOsmLandAreaByIdentity: async () => null,
            findLandAreaRenderSuppression: async () => ({ feature_key: "osm:way:9200000001" }),
        } as unknown as CoreReviewLandAreasRepository);
        await assert.rejects(
            () =>
                promote.promoteOsmLandArea({
                    feature_key: "osm:way:9200000001",
                    local_source: "base",
                    geometry,
                    class_code: "residential",
                }),
            CoreReviewSuppressedError,
        );
    });
});
