import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseBuildingOsmFeatureKey } from "./building-osm-feature-key.js";

describe("parseBuildingOsmFeatureKey", () => {
    it("equates osm:way:123, osm:W:123, and typed way+123", () => {
        const a = parseBuildingOsmFeatureKey("osm:way:123");
        const b = parseBuildingOsmFeatureKey("osm:W:123");
        const c = parseBuildingOsmFeatureKey("way:123");
        assert.deepEqual(a, {
            featureKey: "osm:way:123",
            sourceFeatureType: "way",
            sourceFeatureId: 123n,
        });
        assert.deepEqual(a, b);
        assert.deepEqual(a, c);
    });

    it("rejects nodes and junk", () => {
        assert.equal(parseBuildingOsmFeatureKey("osm:node:1"), null);
        assert.equal(parseBuildingOsmFeatureKey("osm:way:0"), null);
        assert.equal(parseBuildingOsmFeatureKey("nope"), null);
    });
});
