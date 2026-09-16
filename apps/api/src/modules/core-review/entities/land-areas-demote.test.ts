import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    CoreReviewDemoteBlockedError,
    CoreReviewNotFoundError,
} from "../core-review-write.errors.js";
import { LandAreasDemoteService } from "./land-areas-demote.service.js";
import type {
    CoreReviewLandAreasRepository,
    LandAreaDemoteSnapshotRow,
} from "./land-areas.repo.js";

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

const identity = {
    id: "21",
    public_id: "22222222-2222-2222-2222-222222222222",
    external_id: "osm:way:9200000001",
    source_feature_type: "way",
    source_feature_id: "9200000001",
    is_active: true,
    deleted_at: null,
};

function snapshot(): LandAreaDemoteSnapshotRow {
    return {
        id: "21",
        public_id: identity.public_id,
        external_id: "osm:way:9200000001",
        class_code: "residential",
        land_area_class_id: "3",
        admin_area_id: null,
        region_code: null,
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
        verified_at: null,
        verified_by: null,
        verification_note: null,
        source_registry_id: "1",
        source_snapshot_id: null,
        source_feature_type: "way",
        source_feature_id: "9200000001",
        source_tags: {},
        source_refs: { source: "osm_myanmar" },
        normalized_data: { class_code: "residential" },
        name: "LAND_A_BASE",
        geometry,
        centroid: null,
    };
}

function makeService(repo: Partial<CoreReviewLandAreasRepository>) {
    return new LandAreasDemoteService(repo as CoreReviewLandAreasRepository);
}

describe("LandAreasDemoteService demote OSM land area", () => {
    const body = { feature_key: "osm:W:9200000001" };

    it("preflight returns snapshot for an active Core identity", async () => {
        const service = makeService({
            findOsmLandAreaByIdentity: async () => identity,
            getLandAreaDemoteSnapshot: async () => snapshot(),
            listLandAreaNamesForDemote: async () => [],
            countImportReviewLandAreaLinks: async () => 0,
            countOpenLandAreaReports: async () => 0,
        });
        const result = await service.preflightDemoteOsmLandArea(body);
        assert.equal(result.feature_key, "osm:way:9200000001");
        assert.equal(result.core_id, "21");
        assert.equal(result.class_code, "residential");
        assert.equal(result.core_snapshot.detail_level, "zone");
        assert.equal(result.core_snapshot.land_area_class_id, "3");
    });

    it("stops when no active Core exists", async () => {
        const service = makeService({
            findOsmLandAreaByIdentity: async () => null,
        });
        await assert.rejects(() => service.preflightDemoteOsmLandArea(body), CoreReviewNotFoundError);
    });

    it("blocks import-review links without deleting", async () => {
        let removed = false;
        const service = makeService({
            findOsmLandAreaByIdentity: async () => identity,
            getLandAreaDemoteSnapshot: async () => snapshot(),
            countImportReviewLandAreaLinks: async () => 2,
            countOpenLandAreaReports: async () => 0,
            removeActiveLandAreaForDemote: async () => {
                removed = true;
                return { id: "21", public_id: identity.public_id };
            },
        });
        await assert.rejects(() => service.preflightDemoteOsmLandArea(body), CoreReviewDemoteBlockedError);
        await assert.rejects(() => service.removeDemotedOsmLandArea(body, testUser), CoreReviewDemoteBlockedError);
        assert.equal(removed, false);
    });

    it("hard-removes Core after a clean preflight", async () => {
        let removed = 0;
        const service = makeService({
            findOsmLandAreaByIdentity: async () => identity,
            getLandAreaDemoteSnapshot: async () => snapshot(),
            listLandAreaNamesForDemote: async () => [],
            countImportReviewLandAreaLinks: async () => 0,
            countOpenLandAreaReports: async () => 0,
            removeActiveLandAreaForDemote: async (args) => {
                removed += 1;
                assert.equal(args.publicId, identity.public_id);
                assert.equal(args.before.feature_key, "osm:way:9200000001");
                return { id: "21", public_id: identity.public_id };
            },
        });
        const result = await service.removeDemotedOsmLandArea(body, testUser);
        assert.equal(removed, 1);
        assert.equal(result.removed, true);
        assert.equal(result.core_id, "21");
    });
});
