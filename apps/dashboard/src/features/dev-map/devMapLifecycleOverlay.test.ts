import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    DEV_MAP_LIFECYCLE_COLORS,
    DEV_MAP_LIFECYCLE_LAYER_IDS,
    DEV_MAP_LIFECYCLE_MIN_ZOOM,
    DEV_MAP_LIFECYCLE_SELECTION_PRIORITY,
    DEV_MAP_LIFECYCLE_SOURCE_IDS,
    DEV_MAP_LIFECYCLE_SOURCE_LAYERS,
    buildDevMapLifecycleTileUrlTemplate,
    createDevMapTransformRequest,
    isDevMapLifecycleLayerId,
    lifecycleEntityForLayerId,
    refreshDevMapLifecycleOverlay,
} from "./devMapLifecycleOverlay.js";

describe("Dev Map lifecycle overlay constants", () => {
    it("maps lifecycle states to distinct bright colors", () => {
        assert.equal(DEV_MAP_LIFECYCLE_COLORS.base, "#00E5FF");
        assert.equal(DEV_MAP_LIFECYCLE_COLORS.core, "#00E676");
        assert.equal(DEV_MAP_LIFECYCLE_COLORS.archive, "#FF9100");
        assert.notEqual(DEV_MAP_LIFECYCLE_COLORS.base, DEV_MAP_LIFECYCLE_COLORS.core);
        assert.notEqual(DEV_MAP_LIFECYCLE_COLORS.core, DEV_MAP_LIFECYCLE_COLORS.archive);
    });

    it("exposes stable source/layer ids and zoom gates", () => {
        assert.equal(DEV_MAP_LIFECYCLE_SOURCE_IDS.buildings, "dev-map-lifecycle-buildings");
        assert.equal(DEV_MAP_LIFECYCLE_SOURCE_IDS.land, "dev-map-lifecycle-land");
        assert.equal(DEV_MAP_LIFECYCLE_SOURCE_LAYERS.buildings, "buildings_lifecycle");
        assert.equal(DEV_MAP_LIFECYCLE_SOURCE_LAYERS.land, "land_lifecycle");
        assert.equal(DEV_MAP_LIFECYCLE_MIN_ZOOM.buildings, 15);
        assert.equal(DEV_MAP_LIFECYCLE_MIN_ZOOM.land, 14);
        assert.ok(DEV_MAP_LIFECYCLE_SELECTION_PRIORITY.buildings < 10);
        assert.ok(DEV_MAP_LIFECYCLE_SELECTION_PRIORITY.land < 40);
    });

    it("identifies lifecycle layer ids", () => {
        assert.equal(isDevMapLifecycleLayerId(DEV_MAP_LIFECYCLE_LAYER_IDS.buildingsFill), true);
        assert.equal(lifecycleEntityForLayerId(DEV_MAP_LIFECYCLE_LAYER_IDS.landOutline), "land");
        assert.equal(isDevMapLifecycleLayerId("buildings-yangon"), false);
    });
});

describe("Dev Map lifecycle tile URL + auth transform", () => {
    it("builds API MVT tile templates (not GeoJSON, not PMTiles)", () => {
        process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:3001";
        const url = buildDevMapLifecycleTileUrlTemplate("buildings", 42);
        assert.match(url, /^http:\/\/localhost:3001\/local-basemap\/tiles\/buildings_lifecycle\/\{z\}\/\{x\}\/\{y\}\?v=42$/);
        assert.equal(url.includes(".geojson"), false);
        assert.equal(url.includes("pmtiles"), false);
    });

    it("adds Bearer for local-basemap tile requests", () => {
        const prev = (globalThis as { window?: unknown }).window;
        (globalThis as { window: unknown }).window = {
            localStorage: {
                getItem: (key: string) => (key === "accessToken" ? "test-token" : null),
                setItem: () => undefined,
                removeItem: () => undefined,
                clear: () => undefined,
                key: () => null,
                length: 0,
            },
        };
        try {
            const transform = createDevMapTransformRequest();
            const result = transform(
                "http://localhost:3001/local-basemap/tiles/buildings_lifecycle/15/1/1",
                "Tile" as never,
            );
            assert.ok(result && !(result instanceof Promise));
            assert.equal(
                (result as { headers?: Record<string, string> }).headers?.Authorization,
                "Bearer test-token",
            );
        } finally {
            (globalThis as { window?: unknown }).window = prev;
        }
    });
});

describe("refreshDevMapLifecycleOverlay", () => {
    it("busts tile URLs via setTiles without changing camera", () => {
        process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:3001";
        const setTilesCalls: string[][] = [];
        const map = {
            getSource: (id: string) => {
                if (id === DEV_MAP_LIFECYCLE_SOURCE_IDS.buildings) {
                    return {
                        setTiles: (tiles: string[]) => {
                            setTilesCalls.push(tiles);
                        },
                    };
                }
                return null;
            },
        };

        refreshDevMapLifecycleOverlay(map as never, "buildings");
        assert.equal(setTilesCalls.length, 1);
        assert.match(setTilesCalls[0]![0]!, /buildings_lifecycle/);
        assert.match(setTilesCalls[0]![0]!, /\?v=1$/);

        refreshDevMapLifecycleOverlay(map as never, "buildings");
        assert.match(setTilesCalls[1]![0]!, /\?v=2$/);
    });
});
