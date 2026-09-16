import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    actionsForLifecycleState,
    lifecycleStateLabel,
} from "./localBasemapActions.js";

describe("local basemap UI actions by state", () => {
    it("shows Promote for Base and Archive", () => {
        assert.deepEqual(actionsForLifecycleState("base"), ["promote"]);
        assert.deepEqual(actionsForLifecycleState("archive"), ["promote"]);
    });

    it("shows Demote and Delete for Core (visually distinct in UI)", () => {
        assert.deepEqual(actionsForLifecycleState("core"), ["demote", "delete"]);
    });

    it("labels Deleted/Suppressed clearly", () => {
        assert.equal(lifecycleStateLabel("deleted"), "Deleted/Suppressed");
    });
});

describe("local basemap production-hidden guard", () => {
    it("helper module documents production denial via NODE_ENV", async () => {
        // Soft check: production path is encoded in the helper source so a
        // production Next build never enables the nav/page without both flags.
        const fs = await import("node:fs");
        const path = await import("node:path");
        const file = path.resolve(
            path.dirname(new URL(import.meta.url).pathname),
            "isLocalBasemapAdminUiEnabled.ts"
        );
        const src = fs.readFileSync(file, "utf8");
        assert.match(src, /NODE_ENV === "production"/);
        assert.match(src, /NEXT_PUBLIC_ENABLE_LOCAL_BASEMAP_ADMIN/);
        assert.match(src, /isLocalDevHost/);
    });
});
