import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { actionsForLifecycleState } from "../local-basemap/localBasemapActions.js";

import {
    DEV_MAP_DELETE_CONFIRM,
    DEV_MAP_LIFECYCLE_ACTION_MATRIX,
    bannerFromLifecycleResult,
    buildLifecycleCommandActions,
    lifecycleActionUi,
    resolveLifecycleActionsForDetail,
} from "./devMapInspectorLifecycle.js";

function read(name: string): string {
    return fs.readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
}

describe("Dev Map lifecycle action matrix (no actions lost)", () => {
    const requiredRows: Array<{
        entity: "buildings" | "land";
        state: "base" | "archive" | "core";
        action: "promote" | "demote" | "delete";
    }> = [
        { entity: "buildings", state: "base", action: "promote" },
        { entity: "buildings", state: "archive", action: "promote" },
        { entity: "buildings", state: "core", action: "demote" },
        { entity: "buildings", state: "core", action: "delete" },
        { entity: "land", state: "base", action: "promote" },
        { entity: "land", state: "archive", action: "promote" },
        { entity: "land", state: "core", action: "demote" },
        { entity: "land", state: "core", action: "delete" },
    ];

    it("matrix covers required Building/Land state → action pairs", () => {
        for (const row of requiredRows) {
            const match = DEV_MAP_LIFECYCLE_ACTION_MATRIX.find(
                (m) => m.entity === row.entity && m.state === row.state,
            );
            assert.ok(match, `missing matrix row ${row.entity}/${row.state}`);
            assert.deepEqual(
                match.existingBeforeDevMap,
                match.availableInDevMap,
                `${row.entity}/${row.state}: Dev Map actions diverge from pre-Dev-Map`,
            );
            assert.ok(
                match.availableInDevMap.includes(row.action),
                `${row.entity} ${row.state} → ${row.action} missing in Dev Map`,
            );
            assert.deepEqual(
                match.availableInDevMap,
                actionsForLifecycleState(row.state),
                `${row.entity}/${row.state}: must equal shared actionsForLifecycleState`,
            );
        }
    });

    it("prefers backend available_actions when present", () => {
        assert.deepEqual(
            resolveLifecycleActionsForDetail({
                lifecycle_state: "core",
                available_actions: ["demote"],
            }),
            ["demote"],
        );
        assert.deepEqual(
            resolveLifecycleActionsForDetail({
                lifecycle_state: "core",
                available_actions: [],
            }),
            ["demote", "delete"],
        );
    });

    it("builds UI commands with Local Basemap labels and delete confirm flag", () => {
        const core = buildLifecycleCommandActions({
            lifecycle_state: "core",
            available_actions: ["demote", "delete"],
        });
        assert.deepEqual(
            core.map((a) => a.id),
            ["demote", "delete"],
        );
        assert.equal(lifecycleActionUi("promote").label, "Promote to Core");
        assert.equal(lifecycleActionUi("demote").label, "Demote to Local");
        assert.equal(lifecycleActionUi("delete").requiresConfirm, true);
        assert.equal(lifecycleActionUi("demote").requiresConfirm, false);
    });

    it("delete confirmation copy matches Local Basemap admin", () => {
        const localPage = fs.readFileSync(
            fileURLToPath(
                new URL("../local-basemap/LocalBasemapPage.tsx", import.meta.url),
            ),
            "utf8",
        );
        assert.match(localPage, new RegExp(DEV_MAP_DELETE_CONFIRM.title.replace("?", "\\?")));
        assert.match(localPage, /Delete and suppress/);
        assert.match(localPage, /keeps Archive/);
        assert.equal(DEV_MAP_DELETE_CONFIRM.confirmLabel, "Delete and suppress");
    });
});

describe("Dev Map lifecycle action result banners", () => {
    it("maps blocked demotion / API failure / stale sync", () => {
        const blocked = bannerFromLifecycleResult({
            feature_key: "osm:way:1",
            operation: "demote",
            ok: false,
            sync_stale: false,
            message: "Demote blocked by dependencies",
            dependencies: [{ code: "addresses", count: 2, message: "linked addresses" }],
        });
        assert.equal(blocked.tone, "error");
        assert.match(blocked.message, /blocked/i);
        assert.ok(blocked.dependencies?.[0]?.includes("addresses"));

        const stale = bannerFromLifecycleResult({
            feature_key: "osm:way:1",
            operation: "promote",
            ok: true,
            sync_stale: true,
            message: "Promoted; sync_stale — Core still catching up",
        });
        assert.equal(stale.tone, "warning");
        assert.match(stale.message, /sync_stale|Promoted/i);

        const ok = bannerFromLifecycleResult({
            feature_key: "osm:way:1",
            operation: "promote",
            ok: true,
            sync_stale: false,
            message: "Promoted to Core",
        });
        assert.equal(ok.tone, "success");
    });
});

describe("Dev Map inspector wires reuse (no alternate endpoints)", () => {
    it("calls runLocalBasemapAction and refreshes overlay without camera moves", () => {
        const lifecycle = read("devMapInspectorLifecycle.ts");
        assert.match(lifecycle, /runLocalBasemapAction/);
        assert.doesNotMatch(lifecycle, /\/buildings\/promote|promoteOsmBuilding/);

        const card = read("DevMapInspector.tsx");
        assert.match(card, /refreshDevMapLifecycleOverlay/);
        assert.match(card, /CoreReviewConfirmDialog/);
        assert.doesNotMatch(card, /flyTo\(|easeTo\(|fitBounds\(/);
        // Open Details / Edit / Local Basemap open in a new tab so Dev Map selection stays.
        assert.match(card, /target=["']_blank["']/);
        assert.match(card, /rel=["']noopener noreferrer["']/);
        assert.doesNotMatch(card, /router\.push/);

        // Page may easeTo when enabling Places/Transport below min zoom — that is OK.
        // Lifecycle actions must not move the camera (checked on card + lifecycle module above).
        const page = read("DevMapPage.tsx");
        assert.match(page, /minSelectableZoom/);
    });

    it("does not drop Base/Archive promote or Core demote/delete from adapters", () => {
        const adapters = read("devMapInspectorAdapters.ts");
        assert.match(adapters, /buildLifecycleCommandActions/);
        assert.match(adapters, /lifecycleEntity/);
    });
});
