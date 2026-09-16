import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { getDevMapEntityEntry } from "./devMapEntityRegistry.js";
import {
    DEV_MAP_SEARCH_DEFERRED,
    DEV_MAP_SEARCH_SUPPORTED_TYPES,
    flyToDevMapSelection,
    looksLikeLocalBasemapIdQuery,
    mapSearchDocumentToDevMapEntity,
    shouldAutoEnableEntityForSearchHit,
} from "./devMapSearch.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function readFeature(name: string): string {
    return fs.readFileSync(path.join(here, name), "utf8");
}

describe("Dev Map search helpers", () => {
    it("prefers exact feature_key / OSM id queries for local-basemap first", () => {
        assert.equal(looksLikeLocalBasemapIdQuery("osm:way:123456"), true);
        assert.equal(looksLikeLocalBasemapIdQuery("osm:node:99"), true);
        assert.equal(looksLikeLocalBasemapIdQuery("1234567"), true);
        assert.equal(looksLikeLocalBasemapIdQuery("Shwedagon"), false);
        assert.equal(looksLikeLocalBasemapIdQuery("12"), false);
    });

    it("maps searchable document entity types onto Dev Map entities", () => {
        assert.equal(mapSearchDocumentToDevMapEntity("place"), "places");
        assert.equal(mapSearchDocumentToDevMapEntity("street_group"), "streets");
        assert.equal(mapSearchDocumentToDevMapEntity("admin_area"), "admin");
        assert.equal(mapSearchDocumentToDevMapEntity("transport_stop"), "transport_stops");
        assert.equal(mapSearchDocumentToDevMapEntity("transport_route"), "transport_routes");
        assert.equal(mapSearchDocumentToDevMapEntity("building"), "buildings");
        assert.equal(mapSearchDocumentToDevMapEntity("land_area"), "land");
        assert.equal(mapSearchDocumentToDevMapEntity("address"), null);
    });

    it("lists supported search types without inventing new FTS indexes", () => {
        assert.ok(DEV_MAP_SEARCH_SUPPORTED_TYPES.includes("places"));
        assert.ok(DEV_MAP_SEARCH_SUPPORTED_TYPES.includes("settlements"));
        assert.ok(DEV_MAP_SEARCH_SUPPORTED_TYPES.includes("buildings"));
        assert.ok(DEV_MAP_SEARCH_DEFERRED.some((item) => /full-table building/i.test(item)));
    });

    it("auto-enables only supported entity types that are currently off", () => {
        const enabled = new Set(["buildings"] as const);
        assert.equal(shouldAutoEnableEntityForSearchHit("places", enabled), true);
        assert.equal(shouldAutoEnableEntityForSearchHit("buildings", enabled), false);
        // Settlements are unsupported on the map stack — do not flip checkbox state.
        assert.equal(getDevMapEntityEntry("settlements").supported, false);
        assert.equal(shouldAutoEnableEntityForSearchHit("settlements", enabled), false);
    });

    it("flyTo uses Point flyTo and Polygon fitBounds", () => {
        const calls: Array<{ kind: string; payload: unknown }> = [];
        const map = {
            getZoom: () => 12,
            flyTo: (payload: unknown) => {
                calls.push({ kind: "flyTo", payload });
            },
            fitBounds: (bounds: unknown, opts: unknown) => {
                calls.push({ kind: "fitBounds", payload: { bounds, opts } });
            },
        };

        flyToDevMapSelection(map as never, {
            entityType: "places",
            entityId: "p1",
            featureKey: null,
            coreId: null,
            corePublicId: "p1",
            displayName: "Place",
            sourceLayer: "tiles_places_v",
            layerId: "places-poi",
            geometry: { type: "Point", coordinates: [96.15, 16.8] },
            detailRoute: null,
            detailApi: null,
        });
        assert.equal(calls[0]?.kind, "flyTo");

        calls.length = 0;
        flyToDevMapSelection(map as never, {
            entityType: "buildings",
            entityId: "b1",
            featureKey: "osm:way:1",
            coreId: null,
            corePublicId: null,
            displayName: "Building",
            sourceLayer: "buildings",
            layerId: "buildings",
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [96.1, 16.7],
                        [96.2, 16.7],
                        [96.2, 16.8],
                        [96.1, 16.8],
                        [96.1, 16.7],
                    ],
                ],
            },
            detailRoute: null,
            detailApi: null,
        });
        assert.equal(calls[0]?.kind, "fitBounds");
    });
});

describe("Dev Map search wiring", () => {
    it("reuses existing search / detail APIs (no new FTS endpoint)", () => {
        const src = readFeature("devMapSearch.ts");
        assert.match(src, /listSearchDocuments/);
        assert.match(src, /searchLocalBasemapFeatures/);
        assert.match(src, /getCoreReviewList/);
        assert.match(src, /getPlace|getStreet|getBuilding|getTransportStopDetail/);
        assert.match(src, /resolveDevMapSearchHitToSelection/);
        assert.doesNotMatch(src, /CREATE INDEX|to_tsvector|gin\(/i);
    });

    it("DevMapPage waits for style load before mutating layers", () => {
        const page = readFeature("DevMapPage.tsx");
        assert.match(page, /onLoad:\s*\(map\)\s*=>/);
        assert.match(page, /ensureDevMapSelectionHighlight\(map\)/);
        assert.match(page, /applyDevMapEntityVisibility\(map,\s*enabledEntitiesRef\.current\)/);
        // createDevMapBasemap resolves before style load — must not mutate there.
        assert.doesNotMatch(
            page,
            /\.then\(\(map\)\s*=>\s*\{[\s\S]*?applyDevMapEntityVisibility\(map,\s*initialEnabled\)/,
        );
    });

    it("keeps search compact in the control bar (no separate results page)", () => {
        const chrome = readFeature("DevMapChrome.tsx");
        const control = readFeature("DevMapSearchControl.tsx");
        const pageRoute = fs.readFileSync(
            path.join(here, "../../../src/app/(admin)/dashboard/dev-map/page.tsx"),
            "utf8",
        );
        assert.match(chrome, /DevMapSearchControl/);
        assert.match(chrome, /onSearchSelect/);
        assert.match(control, /runDevMapSearch/);
        assert.match(control, /getDevMapSearchDebounceMs/);
        assert.match(control, /AbortController/);
        assert.doesNotMatch(pageRoute, /search-results|DevMapSearchPage/);
        assert.equal(fs.existsSync(path.join(here, "DevMapSearchPage.tsx")), false);
    });

    it("auto-enables disabled entity types on search select", () => {
        const page = readFeature("DevMapPage.tsx");
        assert.match(page, /shouldAutoEnableEntityForSearchHit/);
        assert.match(page, /toggleDevMapEntityEnabled\(prev,\s*hit\.entityType,\s*true\)/);
    });
});
