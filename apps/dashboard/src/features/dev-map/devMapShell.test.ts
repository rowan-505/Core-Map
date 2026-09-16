import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createOverviewStyle } from "@local-map/map-style/overviewSource";
import { OVERVIEW_VECTOR_SOURCE_ID } from "@local-map/map-style/overviewConstants";

import {
    DEV_MAP_PUBLIC_OVERVIEW_STYLE_NAME,
    assertDevMapUsesPublicOverviewStyle,
} from "./devMapBasemapStyle.js";
import {
    DEV_MAP_PUBLIC_BASEMAP_STYLE_ID,
    buildPublicRegionLayers,
    publicRegionLayerIds,
} from "./publicBasemapRegionLayers.js";
import {
    DEV_MAP_CONTROL_BADGE_TEST_ID,
    DEV_MAP_CONTROL_BAR_TEST_ID,
} from "./devMapChromeIds.js";
import { DEV_MAP_MAX_ZOOM } from "./devMapViewport.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(here, "../../..");
const repoRoot = path.resolve(dashboardRoot, "../..");

function read(relFromDashboard: string): string {
    return fs.readFileSync(path.join(dashboardRoot, relFromDashboard), "utf8");
}

function readRepo(relFromRepo: string): string {
    return fs.readFileSync(path.join(repoRoot, relFromRepo), "utf8");
}

/** Strip block comments so negative import/style checks ignore documentation. */
function withoutBlockComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("Dev Map route shell", () => {
    it("registers /dashboard/dev-map page that renders DevMapPage", () => {
        const page = read("src/app/(admin)/dashboard/dev-map/page.tsx");
        assert.match(page, /DevMapPage/);
        assert.match(page, /from "@\/src\/features\/dev-map\/DevMapPage"/);

        const paths = read("src/lib/dashboardPaths.ts");
        assert.match(paths, /DEV_MAP_PATH = `\$\{DASHBOARD_PATH\}\/dev-map`/);
        assert.match(paths, /export function devMapPath/);
    });

    it("gates the page with isDevMapUiEnabled and reuses local admin flag", () => {
        const gate = read("src/features/dev-map/isDevMapUiEnabled.ts");
        assert.match(gate, /NODE_ENV === "production"/);
        assert.match(gate, /isLocalBasemapAdminUiEnabled/);
        assert.match(gate, /NEXT_PUBLIC_ENABLE_DEV_MAP/);
        assert.match(gate, /isLocalDevHost/);

        const page = read("src/features/dev-map/DevMapPage.tsx");
        assert.match(page, /isDevMapUiEnabled/);
        assert.match(page, /createDevMapBasemap/);
        assert.match(page, /DevMapControlBar/);
        assert.match(page, /DevMapInspector/);
        assert.match(page, /selected=\{selection\}/);
        assert.match(page, /enabledEntities/);
        assert.match(page, /onToggleEntity/);
        assert.match(page, /applyDevMapEntityVisibility/);
        assert.match(page, /resolveDevMapClickSelection/);
        assert.match(page, /setDevMapSelectionHighlight/);
    });
});

describe("Dev Map MapLibre / PMTiles / public style", () => {
    it("creates MapLibre map after ensurePmtilesProtocol (once per tab)", () => {
        const factory = withoutBlockComments(read("src/features/dev-map/createDevMapBasemap.ts"));
        assert.match(factory, /ensurePmtilesProtocol\(maplibregl\)/);
        assert.match(factory, /new maplibregl\.Map\(/);
        assert.match(factory, /startRegionalPmtilesLoader/);
        assert.match(factory, /clampRegionalSourceMaxZoom:\s*true/);
        assert.match(factory, /addPublicRegionLayers/);
        assert.doesNotMatch(factory, /import[\s\S]*createPreviewBaseMap/);
        assert.doesNotMatch(factory, /createDashboardOverviewStyle/);
        assert.doesNotMatch(factory, /createDashboardBasemapStyle/);
        assert.doesNotMatch(factory, /dashboard-map\.json/);
        assert.doesNotMatch(factory, /dashboard-overview-map\.json/);
    });

    it("reuses public overview-map style (not dashboard fork)", () => {
        const styleSrc = read("src/features/dev-map/devMapBasemapStyle.ts");
        assert.match(styleSrc, /createOverviewStyle/);
        assert.match(styleSrc, /DEV_MAP_PUBLIC_OVERVIEW_STYLE_NAME/);

        const style = createOverviewStyle("https://example.test/overview.pmtiles") as {
            name?: string;
            sources?: Record<string, unknown>;
        };
        assert.equal(style.name, DEV_MAP_PUBLIC_OVERVIEW_STYLE_NAME);
        assert.ok(style.sources?.[OVERVIEW_VECTOR_SOURCE_ID]);
        assertDevMapUsesPublicOverviewStyle(style as never);
    });

    it("clones regional layers from public base-map.json", () => {
        assert.equal(DEV_MAP_PUBLIC_BASEMAP_STYLE_ID, "base-map.json");
        const layers = buildPublicRegionLayers("yangon", "region-yangon");
        assert.ok(layers.length > 0);
        assert.ok(layers.every((layer) => layer.id.endsWith("-yangon")));
        assert.ok(layers.every((layer) => "source" in layer && layer.source === "region-yangon"));
        assert.deepEqual(
            publicRegionLayerIds("yangon"),
            layers.map((layer) => layer.id),
        );

        const layerSrc = withoutBlockComments(read("src/features/dev-map/publicBasemapRegionLayers.ts"));
        assert.match(layerSrc, /base-map\.json/);
        assert.doesNotMatch(layerSrc, /dashboard-map\.json/);
    });

    it("uses public camera max zoom (20)", () => {
        assert.equal(DEV_MAP_MAX_ZOOM, 20);
    });
});

describe("Dev Map controls stay off the public web map", () => {
    it("exports stable control test ids that do not appear under apps/web", () => {
        assert.equal(DEV_MAP_CONTROL_BADGE_TEST_ID, "dev-map-badge");
        assert.equal(DEV_MAP_CONTROL_BAR_TEST_ID, "dev-map-control-bar");

        const webRoot = path.join(repoRoot, "apps/web");
        const walk = (dir: string): string[] => {
            const out: string[] = [];
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === "node_modules" || entry.name === "dist") continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) out.push(...walk(full));
                else if (/\.(ts|tsx|js|jsx|html)$/.test(entry.name)) out.push(full);
            }
            return out;
        };
        for (const file of walk(path.join(webRoot, "src"))) {
            const src = fs.readFileSync(file, "utf8");
            assert.doesNotMatch(src, /dev-map-badge/);
            assert.doesNotMatch(src, /DEV_MAP_CONTROL/);
            assert.doesNotMatch(src, /createDevMapBasemap/);
        }
    });
});

describe("Dev Map shell does not reimplement lifecycle logic", () => {
    it("reuses local-basemap action helpers instead of inventing new rules", () => {
        const lifecycle = fs.readFileSync(
            path.join(dashboardRoot, "src/features/dev-map/devMapInspectorLifecycle.ts"),
            "utf8",
        );
        assert.match(lifecycle, /actionsForLifecycleState/);
        assert.match(lifecycle, /runLocalBasemapAction/);
        assert.doesNotMatch(lifecycle, /case "base":\s*return \["promote"\]/);

        const card = fs.readFileSync(
            path.join(dashboardRoot, "src/features/dev-map/DevMapInspector.tsx"),
            "utf8",
        );
        assert.match(card, /runDevMapLifecycleAction|CoreReviewConfirmDialog/);
        assert.match(card, /DEV_MAP_DELETE_CONFIRM/);
    });

    it("leaves local-basemap action helpers unchanged in structure", () => {
        const actions = readRepo("apps/dashboard/src/features/local-basemap/localBasemapActions.ts");
        assert.match(actions, /case "base":/);
        assert.match(actions, /return \["promote"\]/);
        assert.match(actions, /return \["demote", "delete"\]/);
        assert.match(actions, /return \["clear_suppression"\]/);

        const apiActions = readRepo("apps/api/src/modules/local-basemap/local-basemap.actions.ts");
        assert.match(apiActions, /export function actionsForLifecycleState/);
        assert.match(apiActions, /return \["promote"\]/);
        assert.match(apiActions, /return \["demote", "delete"\]/);
    });
});
