import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    BUILDINGS_LIFECYCLE_BASE_MIN_ZOOM,
    BUILDINGS_LIFECYCLE_MIN_ZOOM,
    LAND_LIFECYCLE_BASE_MIN_ZOOM,
    LAND_LIFECYCLE_MIN_ZOOM,
    isValidTileCoord,
    lifecycleSourcesForZoom,
    shouldServeLifecycleTile,
} from "./local-basemap.mvt.js";
import {
    lifecycleEntityFromLayer,
    localBasemapLifecycleTileParamsSchema,
} from "./local-basemap.mvt.schema.js";

describe("lifecycle MVT zoom gates", () => {
    it("buildings: no tiles below outer min zoom", () => {
        assert.equal(shouldServeLifecycleTile("buildings", BUILDINGS_LIFECYCLE_MIN_ZOOM - 1), false);
        assert.equal(shouldServeLifecycleTile("buildings", BUILDINGS_LIFECYCLE_MIN_ZOOM), true);
        assert.deepEqual(lifecycleSourcesForZoom("buildings", BUILDINGS_LIFECYCLE_MIN_ZOOM - 1), []);
    });

    it("buildings/land: Core + Archive only (Base stays on PMTiles)", () => {
        assert.deepEqual(lifecycleSourcesForZoom("buildings", BUILDINGS_LIFECYCLE_MIN_ZOOM), [
            "core",
            "archive",
        ]);
        assert.deepEqual(lifecycleSourcesForZoom("buildings", 20), ["core", "archive"]);
        assert.deepEqual(lifecycleSourcesForZoom("land", LAND_LIFECYCLE_MIN_ZOOM), [
            "core",
            "archive",
        ]);
        assert.equal(BUILDINGS_LIFECYCLE_BASE_MIN_ZOOM, 99);
        assert.equal(LAND_LIFECYCLE_BASE_MIN_ZOOM, 99);
        assert.equal(BUILDINGS_LIFECYCLE_MIN_ZOOM, 15);
        assert.equal(LAND_LIFECYCLE_MIN_ZOOM, 14);
    });

    it("validates tile coordinates", () => {
        assert.equal(isValidTileCoord(0, 0, 0), true);
        assert.equal(isValidTileCoord(1, 2, 0), false);
        assert.equal(isValidTileCoord(-1, 0, 0), false);
    });
});

describe("lifecycle MVT route params", () => {
    it("parses buildings_lifecycle and land_lifecycle paths", () => {
        const buildings = localBasemapLifecycleTileParamsSchema.safeParse({
            layer: "buildings_lifecycle",
            z: "15",
            x: "26120",
            y: "14840",
        });
        assert.equal(buildings.success, true);
        if (buildings.success) {
            assert.equal(lifecycleEntityFromLayer(buildings.data.layer), "buildings");
            assert.equal(buildings.data.z, 15);
        }

        const land = localBasemapLifecycleTileParamsSchema.safeParse({
            layer: "land_lifecycle",
            z: 14,
            x: 800,
            y: 450,
        });
        assert.equal(land.success, true);
        if (land.success) {
            assert.equal(lifecycleEntityFromLayer(land.data.layer), "land");
        }
    });

    it("rejects unknown layers", () => {
        const bad = localBasemapLifecycleTileParamsSchema.safeParse({
            layer: "streets_lifecycle",
            z: 10,
            x: 0,
            y: 0,
        });
        assert.equal(bad.success, false);
    });
});
