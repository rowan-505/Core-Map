import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    candidateFromFeature,
    candidateToSelection,
    listQueryableDevMapLayerIds,
    normalizeDevMapFeatureIdentity,
    pickPrimaryDevMapCandidate,
    resolveDevMapClickSelection,
    testMapFeature,
} from "./devMapClickSelect.js";
import { getDevMapEntityEntry } from "./devMapEntityRegistry.js";
import { setDevMapSelectionHighlight } from "./devMapSelectionHighlight.js";

describe("Dev Map static click select", () => {
    it("prefers core_public_id over numeric core_id for streets", () => {
        const feature = testMapFeature({
            layerId: "road-major-fill-yangon",
            sourceLayer: "streets",
            properties: {
                core_id: "152188",
                core_public_id: "32b36452-b337-42d3-9295-a6633a729d6e",
                name: "Insein Road",
            },
            geometry: {
                type: "LineString",
                coordinates: [
                    [96.1, 16.8],
                    [96.2, 16.85],
                ],
            },
        });
        const candidate = candidateFromFeature(feature, new Set(["streets"]), 14);
        assert.equal(candidate?.entityId, "32b36452-b337-42d3-9295-a6633a729d6e");
        assert.equal(candidate?.coreId, "152188");
        assert.equal(candidate?.corePublicId, "32b36452-b337-42d3-9295-a6633a729d6e");
        const selection = candidateToSelection(candidate!);
        assert.equal(selection?.entityId, "32b36452-b337-42d3-9295-a6633a729d6e");
    });

    it("clicking a street returns street identity (core_id)", () => {
        const street = getDevMapEntityEntry("streets");
        const feature = testMapFeature({
            layerId: "road-major-fill-yangon",
            sourceLayer: "streets",
            properties: {
                core_id: "91234",
                name: "Pyay Road",
                name_en: "Pyay Road",
            },
            geometry: {
                type: "LineString",
                coordinates: [
                    [96.1, 16.8],
                    [96.2, 16.85],
                ],
            },
        });

        const identity = normalizeDevMapFeatureIdentity(street, feature);
        assert.equal(identity?.entityId, "91234");
        assert.equal(identity?.coreId, "91234");

        const enabled = new Set(["streets"] as const);
        const candidate = candidateFromFeature(feature, enabled, 14);
        assert.equal(candidate?.entityType, "streets");
        const selection = candidateToSelection(candidate!);
        assert.equal(selection?.entityType, "streets");
        assert.equal(selection?.entityId, "91234");
        assert.equal(selection?.displayName, "Pyay Road");
        assert.equal(selection?.sourceLayer, "streets");
    });

    it("clicking admin returns admin identity (core_id)", () => {
        const feature = testMapFeature({
            layerId: "admin-boundaries-yangon",
            sourceLayer: "admin_boundaries",
            properties: {
                core_id: "55",
                name: "Kyauktan",
                name_mm: "ကျောက်တန်း",
            },
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [96.4, 16.6],
                        [96.5, 16.6],
                        [96.5, 16.7],
                        [96.4, 16.7],
                        [96.4, 16.6],
                    ],
                ],
            },
        });

        const candidate = candidateFromFeature(feature, new Set(["admin"]), 10);
        assert.equal(candidate?.entityType, "admin");
        assert.equal(candidate?.entityId, "55");
        assert.equal(candidate?.displayName, "Kyauktan");
    });

    it("disabled layers are not selectable", () => {
        const feature = testMapFeature({
            layerId: "road-local-fill-yangon",
            sourceLayer: "streets",
            properties: { core_id: "1", name: "Side Street" },
        });

        const enabled = new Set(["buildings"] as const);
        assert.equal(candidateFromFeature(feature, enabled, 14), null);

        const map = {
            getZoom: () => 14,
            getLayer: (id: string) => ({ id }),
            getStyle: () => ({
                layers: [
                    { id: "road-local-fill-yangon" },
                    { id: "buildings-yangon" },
                ],
            }),
            queryRenderedFeatures: () => [feature],
        };

        const selection = resolveDevMapClickSelection(map, { x: 10, y: 10 }, enabled);
        assert.equal(selection, null);

        const queryable = listQueryableDevMapLayerIds(map, enabled);
        assert.deepEqual(queryable, ["buildings-yangon"]);
        assert.equal(queryable.includes("road-local-fill-yangon"), false);
    });

    it("priority is deterministic (building over street over land)", () => {
        const building = candidateFromFeature(
            testMapFeature({
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
            }),
            new Set(["buildings", "streets", "land"]),
            16,
        );
        const street = candidateFromFeature(
            testMapFeature({
                layerId: "road-major-fill-yangon",
                sourceLayer: "streets",
                properties: { core_id: "2", name: "S" },
            }),
            new Set(["buildings", "streets", "land"]),
            16,
        );
        const land = candidateFromFeature(
            testMapFeature({
                layerId: "landuse-yangon",
                sourceLayer: "landuse",
                properties: { feature_key: "osm:W:3", name: "L" },
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
            new Set(["buildings", "streets", "land"]),
            16,
        );

        assert.ok(building && street && land);
        // Query order street → land → building; priority still picks building.
        const primary = pickPrimaryDevMapCandidate([street, land, building]);
        assert.equal(primary?.entityType, "buildings");
        assert.equal(primary?.entityId, "osm:W:1");
    });

    it("respects minimum selectable zoom", () => {
        const feature = testMapFeature({
            layerId: "buildings-yangon",
            sourceLayer: "buildings",
            properties: { feature_key: "osm:W:9" },
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
        assert.equal(candidateFromFeature(feature, new Set(["buildings"]), 10), null);
        assert.ok(candidateFromFeature(feature, new Set(["buildings"]), 14));
    });

    it("highlight clears and replaces without map recreate", () => {
        const dataCalls: unknown[] = [];
        let removeCalls = 0;
        const layers = new Set<string>();
        const sources = new Map<string, { setData: (d: unknown) => void }>();

        const map = {
            isStyleLoaded: () => true,
            getSource: (id: string) => sources.get(id) ?? null,
            addSource: (id: string, spec: { data: unknown }) => {
                sources.set(id, {
                    setData: (d: unknown) => {
                        dataCalls.push(d);
                    },
                });
                // Seed like MapLibre GeoJSONSource instance check — use duck type via prototype hack
                const src = sources.get(id)!;
                Object.setPrototypeOf(src, {
                    constructor: { name: "GeoJSONSource" },
                });
                // Store data setter path used by highlight helper (instanceof GeoJSONSource).
                // For unit test we patch setDevMapSelectionHighlight path by mocking instanceof:
                void spec;
                return src;
            },
            getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
            addLayer: (layer: { id: string }) => {
                layers.add(layer.id);
            },
            moveLayer: () => undefined,
            remove: () => {
                removeCalls += 1;
            },
        };

        // Bypass instanceof GeoJSONSource by using a real-shaped mock through setData after ensure.
        // Re-implement light assert: ensure creates layers; setData via patched source.
        const { ensureDevMapSelectionHighlight } = require("./devMapSelectionHighlight.ts") as typeof import("./devMapSelectionHighlight.ts");

        // Manual highlight exercise without instanceof: call ensure then inject fake source.
        ensureDevMapSelectionHighlight(map as never);
        assert.ok(layers.has("dev-map-selection-fill"));
        assert.ok(layers.has("dev-map-selection-line"));

        const fakeSource = {
            setData: (d: unknown) => {
                dataCalls.push(d);
            },
        };
        // Force GeoJSONSource instanceof to pass by assigning to map.getSource return with monkeypatch
        const { GeoJSONSource } = require("maplibre-gl") as typeof import("maplibre-gl");
        Object.setPrototypeOf(fakeSource, GeoJSONSource.prototype);
        sources.set("dev-map-selection-highlight", fakeSource);

        setDevMapSelectionHighlight(map as never, {
            entityType: "streets",
            entityId: "1",
            featureKey: null,
            coreId: "1",
            corePublicId: null,
            displayName: "A",
            sourceLayer: "streets",
            layerId: "road-major-fill-yangon",
            geometry: {
                type: "LineString",
                coordinates: [
                    [0, 0],
                    [1, 1],
                ],
            },
            detailRoute: null,
            detailApi: null,
        });
        assert.equal(dataCalls.length, 1);

        setDevMapSelectionHighlight(map as never, null);
        assert.equal(dataCalls.length, 2);
        const cleared = dataCalls[1] as { features: unknown[] };
        assert.equal(cleared.features.length, 0);
        assert.equal(removeCalls, 0);
    });

    it("query path does not imply network — only queryRenderedFeatures", () => {
        let queryCalls = 0;
        const map = {
            getZoom: () => 14,
            getLayer: (id: string) => ({ id }),
            getStyle: () => ({ layers: [{ id: "road-major-fill-yangon" }] }),
            queryRenderedFeatures: () => {
                queryCalls += 1;
                return [
                    testMapFeature({
                        layerId: "road-major-fill-yangon",
                        properties: { core_id: "77", name: "Main" },
                    }),
                ];
            },
            fetch: () => {
                throw new Error("no fetch on click");
            },
        };

        const selection = resolveDevMapClickSelection(
            map,
            { x: 1, y: 2 },
            new Set(["streets"]),
        );
        assert.equal(selection?.entityId, "77");
        assert.equal(queryCalls, 1);
    });

    it("lifecycle overlay buildings beat static PMTiles buildings on click", () => {
        const enabled = new Set(["buildings"] as const);
        const lifecycle = candidateFromFeature(
            testMapFeature({
                layerId: "dev-map-lifecycle-buildings-fill",
                sourceLayer: "buildings_lifecycle",
                properties: {
                    feature_key: "osm:W:live",
                    resolved_source: "core",
                    name: "Live Core",
                },
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
        const staticBuilding = candidateFromFeature(
            testMapFeature({
                layerId: "buildings-yangon",
                sourceLayer: "buildings",
                properties: { feature_key: "osm:W:static", name: "Static" },
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
        assert.ok(lifecycle && staticBuilding);
        assert.ok(lifecycle.selectionPriority < staticBuilding.selectionPriority);
        const primary = pickPrimaryDevMapCandidate([staticBuilding, lifecycle]);
        assert.equal(primary?.entityId, "osm:W:live");
        assert.equal(primary?.featureKey, "osm:W:live");
        assert.equal(primary?.layerId, "dev-map-lifecycle-buildings-fill");
    });

    it("does not query lifecycle building layers below client min zoom", () => {
        const map = {
            getZoom: () => 12,
            getLayer: (id: string) => ({ id }),
            getStyle: () => ({
                layers: [
                    { id: "dev-map-lifecycle-buildings-fill" },
                    { id: "buildings-yangon" },
                ],
            }),
            queryRenderedFeatures: () => [],
        };
        // buildings minSelectableZoom / lifecycle minzoom gate — nothing at z12
        const queryable = listQueryableDevMapLayerIds(map, new Set(["buildings"]));
        assert.deepEqual(queryable, []);
    });

    it("includes lifecycle layers in query list at z15 when present", () => {
        const map = {
            getZoom: () => 15,
            getLayer: (id: string) => ({ id }),
            getStyle: () => ({
                layers: [
                    { id: "buildings-yangon" },
                    { id: "dev-map-lifecycle-buildings-fill" },
                    { id: "dev-map-lifecycle-buildings-outline" },
                ],
            }),
            queryRenderedFeatures: () => [],
        };
        const queryable = listQueryableDevMapLayerIds(map, new Set(["buildings"]));
        assert.equal(queryable[0], "dev-map-lifecycle-buildings-fill");
        assert.ok(queryable.includes("buildings-yangon"));
    });
});
