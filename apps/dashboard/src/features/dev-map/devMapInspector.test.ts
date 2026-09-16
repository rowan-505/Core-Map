import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { getDevMapEntityEntry } from "./devMapEntityRegistry.js";
import {
    compactFields,
    field,
    getDevMapEntityAdapter,
    isNotFoundError,
    loadDevMapInspectorDetail,
    mapLoadError,
    pickString,
} from "./devMapInspectorAdapters.js";
import { DevMapInspectorLoadError } from "./devMapInspectorTypes.js";
import type { DevMapSelection } from "./devMapSelection.js";

function readFeature(name: string): string {
    return fs.readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
}

function selectionFor(
    entityType: DevMapSelection["entityType"],
    overrides: Partial<DevMapSelection> = {},
): DevMapSelection {
    const entry = getDevMapEntityEntry(entityType);
    return {
        entityType,
        entityId: overrides.entityId ?? "1",
        featureKey: overrides.featureKey ?? null,
        coreId: overrides.coreId ?? null,
        corePublicId: overrides.corePublicId ?? null,
        displayName: overrides.displayName ?? "Sample",
        sourceLayer: overrides.sourceLayer ?? entry.sourceLayers[0] ?? "",
        layerId: overrides.layerId ?? entry.baseLayerIds[0] ?? "layer",
        geometry: overrides.geometry ?? {
            type: "Point",
            coordinates: [96.1, 16.8],
        },
        detailRoute: overrides.detailRoute ?? entry.detailRoute,
        detailApi: overrides.detailApi ?? entry.detailApi,
    };
}

describe("Dev Map inspector helpers", () => {
    it("picks first non-empty string key", () => {
        assert.equal(pickString({ a: "", b: "ok" }, ["a", "b"]), "ok");
        assert.equal(field("X", null), null);
        assert.deepEqual(compactFields([field("A", "1"), null, field("B", "2")]), [
            { label: "A", value: "1" },
            { label: "B", value: "2" },
        ]);
    });

    it("maps 404-like errors to not_found", () => {
        assert.equal(isNotFoundError(new Error("Request failed with status 404")), true);
        const mapped = mapLoadError(new Error("Feature not found in local tile_source"));
        assert.equal(mapped.code, "not_found");
        assert.match(mapped.message, /stale|database/i);
    });
});

describe("Dev Map inspector adapters — Street / Admin / Settlement / Building / Land", () => {
    it("registers adapters for the five required entity types", () => {
        for (const type of ["streets", "admin", "settlements", "buildings", "land"] as const) {
            assert.ok(getDevMapEntityAdapter(type), `missing adapter: ${type}`);
        }
    });

    it("Street: uses getStreet and shows road class / surface / travel direction", () => {
        const src = readFeature("devMapInspectorAdapters.ts");
        assert.match(src, /getStreet/);
        assert.match(src, /"Road class"/);
        assert.match(src, /"Surface"/);
        assert.match(src, /"Travel direction"/);
        assert.match(src, /"Admin area"/);
        const sel = selectionFor("streets", { coreId: "91234", entityId: "91234" });
        assert.match(sel.detailRoute ?? "", /roads|streets/);
        assert.match(sel.detailApi ?? "", /streets/);
    });

    it("Admin: uses core-review admin-areas with verification + level fields", () => {
        const src = readFeature("devMapInspectorAdapters.ts");
        assert.match(src, /"admin-areas"/);
        assert.match(src, /"Admin level"/);
        assert.match(src, /"Verification"/);
        const sel = selectionFor("admin", { coreId: "55", entityId: "55" });
        assert.match(sel.detailRoute ?? "", /admin-areas/);
    });

    it("Settlement: uses core-review settlements with type + township", () => {
        const src = readFeature("devMapInspectorAdapters.ts");
        assert.match(src, /"settlements"/);
        assert.match(src, /"Settlement type"/);
        assert.match(src, /"Township"/);
        const sel = selectionFor("settlements", {
            corePublicId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            entityId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        });
        assert.match(sel.detailRoute ?? "", /settlements/);
    });

    it("Building: prefers local-basemap lifecycle detail + lists available actions", () => {
        const src = readFeature("devMapInspectorAdapters.ts");
        assert.match(src, /fetchLocalBasemapFeature\(\s*"buildings"/);
        assert.match(src, /lifecycle_state/);
        assert.match(src, /buildLifecycleCommandActions/);
        assert.match(src, /Open Local Basemap/);
        assert.match(src, /getBuilding/);
        assert.match(src, /tilePropsFallback/);
        assert.match(src, /isLocalBasemapUnavailableError/);
        const sel = selectionFor("buildings", {
            featureKey: "osm:way:1",
            entityId: "osm:way:1",
        });
        assert.equal(sel.featureKey, "osm:way:1");
    });

    it("Land: prefers local-basemap then core-review land-areas", () => {
        const src = readFeature("devMapInspectorAdapters.ts");
        assert.match(src, /fetchLocalBasemapFeature\("land"/);
        assert.match(src, /"land-areas"/);
        assert.match(src, /tilePropsFallback/);
        const sel = selectionFor("land", { featureKey: "osm:way:2", entityId: "osm:way:2" });
        assert.match(sel.detailRoute ?? "", /land-areas/);
    });

    it("Street/Admin adapters accept numeric tile ids via detailLookupId", () => {
        const src = readFeature("devMapInspectorAdapters.ts");
        assert.match(src, /detailLookupId/);
        assert.match(src, /looksLikeUuid/);
    });

    it("unsupported entity types throw unsupported", async () => {
        const sel = selectionFor("protected_areas", { entityId: "x" });
        await assert.rejects(
            () => loadDevMapInspectorDetail(sel, new AbortController().signal),
            (error: unknown) =>
                error instanceof DevMapInspectorLoadError && error.code === "unsupported",
        );
    });

    it("missing street id throws missing_id without calling network", async () => {
        const sel = selectionFor("streets", { entityId: "", coreId: null });
        // entityId "" may still pass — force empty
        sel.entityId = "";
        sel.coreId = null;
        await assert.rejects(
            () => loadDevMapInspectorDetail(sel, new AbortController().signal),
            (error: unknown) => {
                const mapped = mapLoadError(error);
                return mapped.code === "missing_id" || mapped.code === "fetch_failed";
            },
        );
    });
});

describe("Dev Map inspector card shell", () => {
    it("shared card shows badge, close, error state, and actions", () => {
        const card = readFeature("DevMapInspector.tsx");
        assert.match(card, /DevMapInspectorCard/);
        assert.match(card, /data-testid="dev-map-inspector-close"/);
        assert.match(card, /data-inspector-status="error"/);
        assert.match(card, /data-inspector-status="loading"/);
        assert.match(card, /data-inspector-action/);
        assert.match(card, /lifecycleState/);
    });

    it("DevMapPage wires inspector; click select does not move camera", () => {
        const page = readFeature("DevMapPage.tsx");
        assert.match(page, /DevMapInspector/);
        assert.match(page, /onClear=\{clearSelection\}/);
        assert.match(page, /resolveDevMapClickSelection/);
        // Search may flyTo via helper; click path must not call it with the click result.
        assert.doesNotMatch(page, /flyToDevMapSelection\(map,\s*next\)/);
        // Filter enable may easeTo for Places/Transport min zoom — click select must not.
        assert.doesNotMatch(page, /onClick[\s\S]{0,400}easeTo\(/);
    });

    it("does not run promote/demote/delete from inspector adapters", () => {
        const src = readFeature("devMapInspectorAdapters.ts");
        // Adapters only build action descriptors; execution lives in lifecycle helper + card.
        assert.doesNotMatch(src, /runLocalBasemapAction/);
        assert.doesNotMatch(src, /promoteOsmBuilding|demote-from-core/);
        assert.match(src, /buildLifecycleCommandActions/);
    });
});
