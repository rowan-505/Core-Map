import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { actionsForLifecycleState } from "./local-basemap.actions.js";
import {
    isLocalBasemapAdminEnabled,
    localBasemapDisabledReason,
} from "./local-basemap.enabled.js";
import { localBasemapActionBodySchema } from "./local-basemap.schema.js";
import { LocalBasemapService, mapLocalBasemapError } from "./local-basemap.service.js";
import { BuildingDemoteBlockedError } from "../buildings/buildings.service.js";
import type { LocalBasemapTileRepository } from "./local-basemap.repo.js";
import type { BuildingsService } from "../buildings/buildings.service.js";
import type { CoreReviewService } from "../core-review/core-review.service.js";

describe("local-basemap production guard", () => {
    it("is unavailable in production even with flag and tile URL", () => {
        assert.equal(
            isLocalBasemapAdminEnabled({
                NODE_ENV: "production",
                ENABLE_LOCAL_BASEMAP_ADMIN: "true",
                LOCAL_TILE_DATABASE_URL: "postgresql://local/tiles",
            }),
            false
        );
        assert.match(
            localBasemapDisabledReason({
                NODE_ENV: "production",
                ENABLE_LOCAL_BASEMAP_ADMIN: "true",
                LOCAL_TILE_DATABASE_URL: "postgresql://local/tiles",
            }),
            /production/i
        );
    });

    it("requires explicit local flag and tile URL outside production", () => {
        assert.equal(
            isLocalBasemapAdminEnabled({
                NODE_ENV: "development",
                ENABLE_LOCAL_BASEMAP_ADMIN: "true",
                LOCAL_TILE_DATABASE_URL: "postgresql://local/tiles",
            }),
            true
        );
        assert.equal(
            isLocalBasemapAdminEnabled({
                NODE_ENV: "development",
                ENABLE_LOCAL_BASEMAP_ADMIN: "false",
                LOCAL_TILE_DATABASE_URL: "postgresql://local/tiles",
            }),
            false
        );
        assert.equal(
            isLocalBasemapAdminEnabled({
                NODE_ENV: "development",
                ENABLE_LOCAL_BASEMAP_ADMIN: "true",
            }),
            false
        );
    });
});

describe("actionsForLifecycleState", () => {
    it("shows Promote for Base and Archive", () => {
        assert.deepEqual(actionsForLifecycleState("base"), ["promote"]);
        assert.deepEqual(actionsForLifecycleState("archive"), ["promote"]);
    });

    it("shows Demote and Delete for Core", () => {
        assert.deepEqual(actionsForLifecycleState("core"), ["demote", "delete"]);
    });

    it("shows clear suppression for Deleted", () => {
        assert.deepEqual(actionsForLifecycleState("deleted"), ["clear_suppression"]);
    });
});

describe("delete confirmation payload", () => {
    it("accepts DELETE confirm and rejects missing confirm for typed delete bodies", () => {
        const ok = localBasemapActionBodySchema.safeParse({
            feature_key: "osm:way:9100000001",
            confirm: "DELETE",
        });
        assert.equal(ok.success, true);
        const missing = localBasemapActionBodySchema.safeParse({
            feature_key: "osm:way:9100000001",
        });
        assert.equal(missing.success, true);
        assert.equal(missing.success && missing.data.confirm, undefined);
    });
});

describe("LocalBasemapService actions", () => {
    const detail = {
        feature_key: "osm:way:9100000001",
        lifecycle_state: "core" as const,
        name: "x",
        name_en: null,
        name_mm: null,
        class_code: "yes",
        osm_id: "9100000001",
        osm_feature_type: "way",
        core_id: "1",
        core_public_id: "11111111-1111-1111-1111-111111111111",
        source_identity: "osm:way:9100000001",
        geometry: { type: "Polygon" as const, coordinates: [] },
        geometry_source: "core" as const,
        available_actions: ["demote" as const, "delete" as const],
        local_layers: { base: true, archive: false, core: true, suppressed: false },
    };

    it("Promote uses existing buildings service and reports stale sync", async () => {
        let promoted = false;
        const service = new LocalBasemapService(
            {
                lookupPromoteCandidate: async () => ({
                    suppressed: false,
                    local_source: "base",
                    class_code: "yes",
                    name: "FAILSAFE_BASE",
                    name_mm: null,
                    name_en: null,
                    geometry: { type: "Polygon", coordinates: [[[96, 16], [96, 16.001], [96.001, 16.001], [96.001, 16], [96, 16]]] },
                }),
                getDetail: async () => detail,
            } as unknown as LocalBasemapTileRepository,
            {
                promoteOsmBuilding: async () => {
                    promoted = true;
                    return {};
                },
            } as unknown as BuildingsService,
            {} as CoreReviewService,
            async () => ({ ok: false, detail: "timeout" })
        );
        const result = await service.promote("buildings", "osm:way:9100000001", {
            sub: "1",
            id: "1",
            email: "a@b.c",
            roles: ["admin"],
        });
        assert.equal(promoted, true);
        assert.equal(result.ok, true);
        assert.equal(result.sync_stale, true);
        assert.match(result.message, /stale cache/i);
    });

    it("Demote reports dependency-blocked error without claiming success", async () => {
        const service = new LocalBasemapService(
            {
                lookupPromoteCandidate: async () => null,
                writeArchiveFromPreflight: async () => undefined,
                getDetail: async () => detail,
            } as unknown as LocalBasemapTileRepository,
            {
                preflightDemoteOsmBuilding: async () => {
                    throw new BuildingDemoteBlockedError("blocked", [
                        { code: "place_building_links", count: 1, message: "link" },
                    ]);
                },
            } as unknown as BuildingsService,
            {} as CoreReviewService,
            async () => ({ ok: true, detail: "ok" })
        );
        await assert.rejects(
            () =>
                service.demote("buildings", "osm:way:9100000001", {
                    sub: "1",
                    id: "1",
                    email: "a@b.c",
                    roles: ["admin"],
                }),
            BuildingDemoteBlockedError
        );
        const mapped = mapLocalBasemapError(
            new BuildingDemoteBlockedError("blocked", [
                { code: "place_building_links", count: 1, message: "link" },
            ])
        );
        assert.equal(mapped.status, 409);
        assert.ok(Array.isArray((mapped.body as { dependencies?: unknown }).dependencies));
    });

    it("Demote keeps Archive and reports Core still wins when removal fails", async () => {
    let archived = false;
    const service = new LocalBasemapService(
      {
        writeArchiveFromPreflight: async () => {
          archived = true;
        },
        getDetail: async () => detail,
      } as unknown as LocalBasemapTileRepository,
      {
        preflightDemoteOsmBuilding: async () => ({
          feature_key: "osm:way:9100000001",
          core_id: "1",
          public_id: "11111111-1111-1111-1111-111111111111",
          class_code: "yes",
          name: "x",
          name_mm: null,
          name_en: null,
          geometry: { type: "Polygon", coordinates: [] },
          core_snapshot: { public_id: "11111111-1111-1111-1111-111111111111", geometry: {} },
        }),
        removeDemotedOsmBuilding: async () => {
          throw new Error("backend down");
        },
      } as unknown as BuildingsService,
      {} as CoreReviewService,
      async () => ({ ok: true, detail: "ok" })
    );
    const result = await service.demote("buildings", "osm:way:9100000001", {
      sub: "1",
      id: "1",
      email: "a@b.c",
      roles: ["admin"],
    });
    assert.equal(archived, true);
    assert.equal(result.ok, false);
    assert.match(result.message, /Core still wins/i);
  });

  it("Delete requires confirm at route layer; service delete reports stale sync", async () => {
        let deleted = false;
        const service = new LocalBasemapService(
            {
                getDetail: async () => ({ ...detail, lifecycle_state: "deleted", available_actions: ["clear_suppression"] }),
            } as unknown as LocalBasemapTileRepository,
            {
                deleteOsmBuildingFromTiles: async (body: { confirm: string }) => {
                    assert.equal(body.confirm, "DELETE");
                    deleted = true;
                    return { suppressed: true };
                },
            } as unknown as BuildingsService,
            {} as CoreReviewService,
            async () => ({ ok: false, detail: "sync fail" })
        );
        const result = await service.delete("buildings", "osm:way:9100000001", {
            sub: "1",
            id: "1",
            email: "a@b.c",
            roles: ["admin"],
        });
        assert.equal(deleted, true);
        assert.equal(result.sync_stale, true);
        assert.match(result.message, /stale cache/i);
    });
});
