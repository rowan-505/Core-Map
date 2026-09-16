import assert from "node:assert/strict";
import { describe, it } from "node:test";

import BaseMapStyle from "@local-map/map-style/base-map.json";

import {
    applyDevMapFilterPreset,
    isSingleEntityFilter,
    toggleDevMapEntityEnabled,
} from "./devMapEntityFilterState.js";
import {
    DEV_MAP_ENTITY_REGISTRY,
    createDefaultDevMapEnabledEntities,
    getDevMapEntityEntry,
    getSelectableDevMapEntityTypes,
    isDevMapLayerIdForEntity,
    listSupportedDevMapEntities,
    type DevMapEntityType,
} from "./devMapEntityRegistry.js";
import { applyDevMapEntityVisibility } from "./devMapEntityVisibility.js";

describe("Dev Map entity registry", () => {
    it("PMTiles-supported entries use real base-map.json layer ids", () => {
        const styleLayerIds = new Set(
            (BaseMapStyle.layers as { id: string }[]).map((layer) => layer.id),
        );

        for (const entry of listSupportedDevMapEntities()) {
            assert.ok(entry.baseLayerIds.length > 0, `${entry.entityType} needs baseLayerIds`);
            assert.ok(entry.sourceLayers.length > 0, `${entry.entityType} needs sourceLayers`);
            if (entry.sourceKind !== "pmtiles") {
                continue;
            }
            for (const layerId of entry.baseLayerIds) {
                assert.ok(
                    styleLayerIds.has(layerId),
                    `${entry.entityType}: missing layer "${layerId}" in base-map.json`,
                );
            }
        }
    });

    it("marks places/transport as dynamic-supported; settlements/protected remain unsupported", () => {
        assert.equal(getDevMapEntityEntry("places").supported, true);
        assert.equal(getDevMapEntityEntry("transport_stops").supported, true);
        assert.equal(getDevMapEntityEntry("transport_routes").supported, true);
        assert.equal(getDevMapEntityEntry("places").sourceKind, "dynamic");
        const unsupported = new Set(
            DEV_MAP_ENTITY_REGISTRY.filter((entry) => !entry.supported).map((e) => e.entityType),
        );
        assert.ok(unsupported.has("settlements"));
        assert.ok(unsupported.has("protected_areas"));
        assert.equal(unsupported.has("places"), false);
    });

    it("matches regional clone layer ids", () => {
        const buildings = DEV_MAP_ENTITY_REGISTRY.find((e) => e.entityType === "buildings")!;
        assert.equal(isDevMapLayerIdForEntity("buildings", buildings), true);
        assert.equal(isDevMapLayerIdForEntity("buildings-yangon", buildings), true);
        assert.equal(isDevMapLayerIdForEntity("landuse-yangon", buildings), false);
    });
});

describe("Dev Map entity filter state", () => {
    it("supports multi-select enable", () => {
        let enabled = new Set(createDefaultDevMapEnabledEntities());
        enabled = toggleDevMapEntityEnabled(enabled, "buildings", false);
        enabled = toggleDevMapEntityEnabled(enabled, "streets", true);
        assert.equal(enabled.has("buildings"), false);
        assert.equal(enabled.has("streets"), true);
        assert.equal(enabled.has("water"), true);
        assert.ok(getSelectableDevMapEntityTypes(enabled).includes("streets"));
        assert.equal(getSelectableDevMapEntityTypes(enabled).includes("buildings"), false);
    });

    it("supports single-select (one entity alone)", () => {
        let enabled = new Set<DevMapEntityType>();
        enabled = toggleDevMapEntityEnabled(enabled, "buildings", true);
        assert.deepEqual([...enabled], ["buildings"]);
        assert.equal(isSingleEntityFilter(enabled), true);
        assert.deepEqual(getSelectableDevMapEntityTypes(enabled), ["buildings"]);
    });

    it("excludes unsupported types from selectable registry state", () => {
        const enabled = new Set(createDefaultDevMapEnabledEntities());
        enabled.add("places");
        enabled.add("settlements");
        const selectable = getSelectableDevMapEntityTypes(enabled);
        assert.equal(selectable.includes("places"), true);
        assert.equal(selectable.includes("settlements"), false);
        assert.ok(selectable.every((type) => {
            const entry = DEV_MAP_ENTITY_REGISTRY.find((e) => e.entityType === type)!;
            return entry.supported && enabled.has(type);
        }));
    });

    it("ignores toggling unsupported entities", () => {
        const before = createDefaultDevMapEnabledEntities();
        const after = toggleDevMapEntityEnabled(before, "protected_areas", true);
        assert.equal(after.has("protected_areas"), false);
        assert.deepEqual([...after].sort(), [...before].sort());
    });

    it("presets All / Core Data / Transport / Clear are trivial sets", () => {
        const all = applyDevMapFilterPreset("all");
        assert.ok(all.has("buildings"));
        assert.equal(all.has("places"), false);
        assert.equal(all.has("transport_stops"), false);
        assert.ok(all.has("water"));

        const core = applyDevMapFilterPreset("core");
        assert.deepEqual(
            [...core].sort(),
            ["admin", "buildings", "land", "streets", "water"].sort(),
        );

        const transport = applyDevMapFilterPreset("transport");
        assert.deepEqual(
            [...transport].sort(),
            ["admin", "streets", "transport_routes", "transport_stops"].sort(),
        );

        const clear = applyDevMapFilterPreset("clear");
        const defaults = createDefaultDevMapEnabledEntities();
        assert.deepEqual([...clear].sort(), [...defaults].sort());
    });
});

describe("Dev Map entity visibility apply", () => {
    it("toggles layout visibility without recreating the map", () => {
        const layout = new Map<string, string>();
        let removeCalls = 0;
        const sources = new Set<string>();
        const layers = new Map<string, { id: string }>([
            ["buildings-yangon", { id: "buildings-yangon" }],
            ["landuse-yangon", { id: "landuse-yangon" }],
        ]);
        const map = {
            getZoom: () => 16,
            getStyle: () => ({
                layers: [
                    { id: "buildings-yangon" },
                    { id: "landuse-yangon" },
                    { id: "overview-land" },
                ],
            }),
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
            setLayoutProperty: (id: string, key: string, value: string) => {
                assert.equal(key, "visibility");
                layout.set(id, value);
            },
            triggerRepaint: () => undefined,
            remove: () => {
                removeCalls += 1;
            },
        };

        process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:3001";
        applyDevMapEntityVisibility(map as never, new Set(["buildings"]));
        assert.equal(layout.get("buildings-yangon"), "visible");
        assert.equal(layout.get("landuse-yangon"), "none");
        assert.equal(layout.has("overview-land"), false);
        assert.ok(sources.has("dev-map-lifecycle-buildings"));
        assert.equal(sources.has("dev-map-lifecycle-land"), false);
        assert.equal(sources.has("tiles_places_v") || sources.has("transport_stops_v"), false);

        applyDevMapEntityVisibility(map as never, new Set(["land"]));
        assert.equal(layout.get("buildings-yangon"), "none");
        assert.equal(layout.get("landuse-yangon"), "visible");
        assert.equal(sources.has("dev-map-lifecycle-buildings"), false);
        assert.ok(sources.has("dev-map-lifecycle-land"));
        assert.equal(removeCalls, 0);
    });
});
