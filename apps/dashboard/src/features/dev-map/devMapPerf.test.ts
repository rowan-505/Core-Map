import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { listQueryableDevMapLayerIds } from "./devMapClickSelect.js";
import { DEV_MAP_DYNAMIC_MIN_ZOOM } from "./devMapDynamicOverlays.js";
import { applyDevMapEntityVisibility } from "./devMapEntityVisibility.js";
import {
    DEV_MAP_LIFECYCLE_LAYER_IDS,
    DEV_MAP_LIFECYCLE_MIN_ZOOM,
    DEV_MAP_LIFECYCLE_SOURCE_IDS,
} from "./devMapLifecycleOverlay.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function readFeature(name: string): string {
    return fs.readFileSync(path.join(here, name), "utf8");
}

describe("Dev Map perf — lazy overlays", () => {
    it("does not create all overlay sources on basemap load unconditionally", () => {
        const factory = readFeature("createDevMapBasemap.ts");
        assert.doesNotMatch(factory, /ensureDevMapLifecycleOverlays\(map\)/);
        assert.doesNotMatch(factory, /ensureDevMapDynamicOverlays\(map\)/);
        assert.match(factory, /applyDevMapEntityVisibility\(map,\s*initialEnabled\)/);
    });

    it("removes lifecycle sources when entity is disabled (stops tile fetch)", () => {
        process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:3001";
        const sources = new Set<string>();
        const layers = new Map<string, { id: string }>();
        const map = {
            getZoom: () => 16,
            getStyle: () => ({ layers: [...layers.keys()].map((id) => ({ id })) }),
            getLayer: (id: string) => layers.get(id),
            getSource: (id: string) => (sources.has(id) ? { id } : undefined),
            addSource: (id: string) => {
                sources.add(id);
            },
            addLayer: (layer: { id: string }) => {
                layers.set(layer.id, { id: layer.id });
            },
            removeLayer: (id: string) => {
                layers.delete(id);
            },
            removeSource: (id: string) => {
                sources.delete(id);
            },
            setLayoutProperty: () => undefined,
            triggerRepaint: () => undefined,
        };

        applyDevMapEntityVisibility(map as never, new Set(["buildings", "land"]));
        assert.ok(sources.has(DEV_MAP_LIFECYCLE_SOURCE_IDS.buildings));
        assert.ok(sources.has(DEV_MAP_LIFECYCLE_SOURCE_IDS.land));
        assert.ok(layers.has(DEV_MAP_LIFECYCLE_LAYER_IDS.buildingsFill));

        applyDevMapEntityVisibility(map as never, new Set());
        assert.equal(sources.has(DEV_MAP_LIFECYCLE_SOURCE_IDS.buildings), false);
        assert.equal(sources.has(DEV_MAP_LIFECYCLE_SOURCE_IDS.land), false);
        assert.equal(layers.has(DEV_MAP_LIFECYCLE_LAYER_IDS.buildingsFill), false);
    });

    it("lifecycle MVT is Core+Archive only; client minzoom matches API", () => {
        assert.equal(DEV_MAP_LIFECYCLE_MIN_ZOOM.buildings, 15);
        assert.equal(DEV_MAP_LIFECYCLE_MIN_ZOOM.land, 14);
        const api = fs.readFileSync(
            path.join(
                here,
                "../../../../api/src/modules/local-basemap/local-basemap.mvt.ts",
            ),
            "utf8",
        );
        assert.match(api, /BUILDINGS_LIFECYCLE_BASE_MIN_ZOOM = 99/);
        assert.match(api, /LAND_LIFECYCLE_BASE_MIN_ZOOM = 99/);
        assert.match(api, /LIFECYCLE_MVT_STATEMENT_TIMEOUT_MS/);
        assert.match(api, /return \["core", "archive"\]/);
    });

    it("dynamic Martin sources use useful minzoom (not 0)", () => {
        assert.equal(DEV_MAP_DYNAMIC_MIN_ZOOM.places, 12);
        assert.equal(DEV_MAP_DYNAMIC_MIN_ZOOM.transport_stops, 11);
        assert.equal(DEV_MAP_DYNAMIC_MIN_ZOOM.transport_routes, 9);
        const src = readFeature("devMapDynamicOverlays.ts");
        assert.doesNotMatch(src, /minzoom:\s*0/);
    });
});

describe("Dev Map perf — click + search", () => {
    it("skips layers with visibility none when querying", () => {
        const map = {
            getZoom: () => 15,
            getStyle: () => ({
                layers: [
                    { id: "buildings-yangon" },
                    { id: "landuse-yangon" },
                    { id: DEV_MAP_LIFECYCLE_LAYER_IDS.buildingsFill },
                ],
            }),
            getLayer: (id: string) => ({ id }),
            getLayoutProperty: (id: string, name: string) => {
                if (name !== "visibility") return undefined;
                if (id === "landuse-yangon") return "none";
                return "visible";
            },
        };
        const ids = listQueryableDevMapLayerIds(map, new Set(["buildings", "land"]));
        assert.ok(ids.includes("buildings-yangon"));
        assert.ok(ids.includes(DEV_MAP_LIFECYCLE_LAYER_IDS.buildingsFill));
        assert.equal(ids.includes("landuse-yangon"), false);
    });

    it("search resolve aborts prior in-flight request", () => {
        const page = readFeature("DevMapPage.tsx");
        assert.match(page, /searchResolveAbortRef/);
        assert.match(page, /searchResolveAbortRef\.current\?\.abort\(\)/);
        assert.match(page, /resolveDevMapSearchHitToSelection/);
    });

    it("DevMapPage attaches ResizeObserver so the canvas is not 0x0", () => {
        const page = readFeature("DevMapPage.tsx");
        assert.match(page, /ResizeObserver/);
        assert.match(page, /map\.resize\(\)/);
    });
});
