import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    candidateFromFeature,
    pickPrimaryDevMapCandidate,
    resolveDevMapClickSelection,
    testMapFeature,
} from "./devMapClickSelect.js";
import { getDevMapEntityEntry } from "./devMapEntityRegistry.js";
import { DEV_MAP_DYNAMIC_LAYER_IDS } from "./devMapDynamicOverlays.js";
import { applyDevMapFilterPreset } from "./devMapEntityFilterState.js";

describe("Dev Map dynamic entities registry", () => {
    it("marks places and transport as supported with Martin source ids", () => {
        const places = getDevMapEntityEntry("places");
        const stops = getDevMapEntityEntry("transport_stops");
        const routes = getDevMapEntityEntry("transport_routes");
        assert.equal(places.supported, true);
        assert.equal(stops.supported, true);
        assert.equal(routes.supported, true);
        assert.equal(places.sourceId, "tiles_places_v");
        assert.equal(stops.sourceId, "transport_stops_v");
        assert.equal(routes.sourceId, "transport_route_paths_v");
        assert.ok(places.selectionPriority < stops.selectionPriority);
        assert.ok(stops.selectionPriority < getDevMapEntityEntry("buildings").selectionPriority);
    });

    it("Transport preset enables transport plus streets/admin context", () => {
        const enabled = applyDevMapFilterPreset("transport");
        assert.deepEqual(
            [...enabled].sort(),
            ["admin", "streets", "transport_routes", "transport_stops"].sort(),
        );
    });
});

describe("Dev Map static + dynamic overlap selection", () => {
    it("place wins over building and land under the same click", () => {
        const enabled = new Set([
            "places",
            "buildings",
            "land",
            "streets",
        ] as const);
        const place = candidateFromFeature(
            testMapFeature({
                layerId: DEV_MAP_DYNAMIC_LAYER_IDS.placesPoi,
                sourceLayer: "tiles_places_v",
                properties: {
                    public_id: "place-uuid-1",
                    name: "Shwedagon",
                },
                geometry: { type: "Point", coordinates: [96.15, 16.8] },
            }),
            enabled,
            15,
        );
        const building = candidateFromFeature(
            testMapFeature({
                layerId: "buildings-yangon",
                sourceLayer: "buildings",
                properties: { feature_key: "osm:W:9", name: "Building" },
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [0, 0],
                            [1, 0],
                            [1, 1],
                            [0, 1],
                            [0, 0],
                        ],
                    ],
                },
            }),
            enabled,
            15,
        );
        const land = candidateFromFeature(
            testMapFeature({
                layerId: "landuse-yangon",
                sourceLayer: "landuse",
                properties: { feature_key: "osm:W:8", name: "Park" },
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [0, 0],
                            [1, 0],
                            [1, 1],
                            [0, 1],
                            [0, 0],
                        ],
                    ],
                },
            }),
            enabled,
            15,
        );
        assert.ok(place && building && land);
        const primary = pickPrimaryDevMapCandidate([land, building, place]);
        assert.equal(primary?.entityType, "places");
        assert.equal(primary?.entityId, "place-uuid-1");
    });

    it("transport stop wins over street and building", () => {
        const enabled = new Set(["transport_stops", "streets", "buildings"] as const);
        const stop = candidateFromFeature(
            testMapFeature({
                layerId: DEV_MAP_DYNAMIC_LAYER_IDS.busStops,
                sourceLayer: "transport_stops_v",
                properties: { public_id: "stop-uuid-1", name: "Sule Stop" },
                geometry: { type: "Point", coordinates: [96.16, 16.77] },
            }),
            enabled,
            14,
        );
        const street = candidateFromFeature(
            testMapFeature({
                layerId: "road-major-fill-yangon",
                sourceLayer: "streets",
                properties: { core_id: "99", name: "Road" },
            }),
            enabled,
            14,
        );
        assert.ok(stop && street);
        assert.equal(pickPrimaryDevMapCandidate([street, stop])?.entityType, "transport_stops");
    });

    it("queryRenderedFeatures path prefers dynamic layers when present", () => {
        const placeFeature = testMapFeature({
            layerId: DEV_MAP_DYNAMIC_LAYER_IDS.placesPoi,
            sourceLayer: "tiles_places_v",
            properties: { public_id: "p1", name: "Cafe" },
            geometry: { type: "Point", coordinates: [96, 16] },
        });
        const buildingFeature = testMapFeature({
            layerId: "buildings-yangon",
            sourceLayer: "buildings",
            properties: { feature_key: "osm:W:1", name: "B" },
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [0, 0],
                        [1, 0],
                        [1, 1],
                        [0, 1],
                        [0, 0],
                    ],
                ],
            },
        });
        const map = {
            getZoom: () => 15,
            getLayer: (id: string) => ({ id }),
            getStyle: () => ({
                layers: [
                    { id: "buildings-yangon" },
                    { id: DEV_MAP_DYNAMIC_LAYER_IDS.placesPoi },
                ],
            }),
            queryRenderedFeatures: (_point: unknown, options?: { layers?: string[] }) => {
                const layers = options?.layers ?? [];
                assert.ok(layers.includes(DEV_MAP_DYNAMIC_LAYER_IDS.placesPoi));
                return [buildingFeature, placeFeature];
            },
        };
        const selection = resolveDevMapClickSelection(
            map,
            { x: 1, y: 1 },
            new Set(["places", "buildings"]),
        );
        assert.equal(selection?.entityType, "places");
        assert.equal(selection?.entityId, "p1");
    });

    it("transport route uses route_code for stable navigation id", () => {
        const route = candidateFromFeature(
            testMapFeature({
                layerId: DEV_MAP_DYNAMIC_LAYER_IDS.busRoutes,
                sourceLayer: "transport_route_paths_v",
                properties: {
                    route_id: "42",
                    route_code: "YBS-21",
                    public_name: "Route 21",
                },
            }),
            new Set(["transport_routes"]),
            12,
        );
        assert.equal(route?.entityId, "YBS-21");
        assert.equal(route?.displayName, "Route 21");
    });
});
