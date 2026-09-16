import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONTROLLED_TEST_FEATURE_KEY,
  parseBuildingPromoteFeatureKey,
  PromoteBuildingError,
  resolveLocalPromoteCandidate,
  runPromoteBuilding,
  type LocalLookup,
  type LocalPromoteCandidate,
  type PromoteApiResult,
} from "./promote-building.lib.ts";

const geometry: LocalPromoteCandidate["geometry"] = {
  type: "Polygon",
  coordinates: [
    [
      [96.0, 16.0],
      [96.0, 16.001],
      [96.001, 16.001],
      [96.001, 16.0],
      [96.0, 16.0],
    ],
  ],
};

const baseCandidate: LocalPromoteCandidate = {
  localSource: "base",
  classCode: "yes",
  name: "TEST_BASE",
  nameMm: null,
  nameEn: null,
  geometry,
};

const archiveCandidate: LocalPromoteCandidate = {
  localSource: "archive",
  classCode: "residential",
  name: "TEST_ARCHIVE",
  nameMm: "မ",
  nameEn: "Archive",
  geometry,
};

function lookup(partial: Partial<LocalLookup>): LocalLookup {
  return {
    suppressed: false,
    archive: null,
    base: null,
    ...partial,
  };
}

describe("parseBuildingPromoteFeatureKey", () => {
  it("accepts canonical and legacy building keys", () => {
    assert.equal(parseBuildingPromoteFeatureKey("osm:way:123").featureKey, "osm:way:123");
    assert.equal(parseBuildingPromoteFeatureKey("osm:W:123").featureKey, "osm:way:123");
    assert.equal(parseBuildingPromoteFeatureKey("osm:relation:9").sourceFeatureType, "relation");
  });

  it("rejects invalid feature_key", () => {
    assert.throws(() => parseBuildingPromoteFeatureKey("not-a-key"), PromoteBuildingError);
    assert.throws(() => parseBuildingPromoteFeatureKey("osm:node:1"), PromoteBuildingError);
  });
});

describe("resolveLocalPromoteCandidate", () => {
  it("prefers archive over base", () => {
    const chosen = resolveLocalPromoteCandidate(lookup({ archive: archiveCandidate, base: baseCandidate }));
    assert.equal(chosen.localSource, "archive");
  });

  it("uses base when archive is absent", () => {
    const chosen = resolveLocalPromoteCandidate(lookup({ base: baseCandidate }));
    assert.equal(chosen.localSource, "base");
  });

  it("fails when missing", () => {
    assert.throws(() => resolveLocalPromoteCandidate(lookup({})), /not found/);
  });
});

describe("runPromoteBuilding", () => {
  it("Base -> Promote", async () => {
    let apiCalled = 0;
    const result = await runPromoteBuilding(
      {
        lookupLocal: async () => lookup({ base: baseCandidate }),
        promoteViaApi: async (payload) => {
          apiCalled += 1;
          assert.equal(payload.local_source, "base");
          assert.equal(payload.feature_key, CONTROLLED_TEST_FEATURE_KEY);
          return {
            feature_key: CONTROLLED_TEST_FEATURE_KEY,
            local_source: "base",
            operation: "created",
            core_id: "101",
            public_id: "00000000-0000-0000-0000-000000000101",
          } satisfies PromoteApiResult;
        },
        syncBuildingsCore: async () => ({ ok: true, detail: "ok" }),
        verifyResolvedSource: async () => "core",
      },
      CONTROLLED_TEST_FEATURE_KEY
    );
    assert.equal(result.exitCode, 0);
    assert.equal(apiCalled, 1);
    assert.match(result.output, /local source used: base/);
    assert.match(result.output, /operation: created/);
    assert.match(result.output, /resolved source: Core/);
  });

  it("Archive -> Promote", async () => {
    const result = await runPromoteBuilding(
      {
        lookupLocal: async () => lookup({ archive: archiveCandidate, base: baseCandidate }),
        promoteViaApi: async (payload) => {
          assert.equal(payload.local_source, "archive");
          return {
            feature_key: CONTROLLED_TEST_FEATURE_KEY,
            local_source: "archive",
            operation: "updated",
            core_id: "202",
            public_id: "00000000-0000-0000-0000-000000000202",
          };
        },
        syncBuildingsCore: async () => ({ ok: true, detail: "ok" }),
        verifyResolvedSource: async () => "core",
      },
      CONTROLLED_TEST_FEATURE_KEY
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /local source used: archive/);
    assert.match(result.output, /operation: updated/);
  });

  it("already Core -> no duplicate", async () => {
    let apiCalled = 0;
    const result = await runPromoteBuilding(
      {
        lookupLocal: async () => lookup({ base: baseCandidate }),
        promoteViaApi: async () => {
          apiCalled += 1;
          return {
            feature_key: CONTROLLED_TEST_FEATURE_KEY,
            local_source: "base",
            operation: "existing",
            core_id: "101",
            public_id: "00000000-0000-0000-0000-000000000101",
          };
        },
        syncBuildingsCore: async () => ({ ok: true, detail: "ok" }),
        verifyResolvedSource: async () => "core",
      },
      CONTROLLED_TEST_FEATURE_KEY
    );
    assert.equal(apiCalled, 1);
    assert.match(result.output, /operation: existing/);
  });

  it("invalid feature_key", async () => {
    await assert.rejects(
      () =>
        runPromoteBuilding(
          {
            lookupLocal: async () => lookup({}),
            promoteViaApi: async () => {
              throw new Error("should not call API");
            },
            syncBuildingsCore: async () => ({ ok: true, detail: "ok" }),
            verifyResolvedSource: async () => "core",
          },
          "bad-key"
        ),
      (error: unknown) => error instanceof PromoteBuildingError && error.code === "invalid_feature_key"
    );
  });

  it("missing feature", async () => {
    await assert.rejects(
      () =>
        runPromoteBuilding(
          {
            lookupLocal: async () => lookup({}),
            promoteViaApi: async () => {
              throw new Error("should not call API");
            },
            syncBuildingsCore: async () => ({ ok: true, detail: "ok" }),
            verifyResolvedSource: async () => "core",
          },
          CONTROLLED_TEST_FEATURE_KEY
        ),
      (error: unknown) => error instanceof PromoteBuildingError && error.code === "missing_feature"
    );
  });

  it("API failure does not sync", async () => {
    let synced = false;
    await assert.rejects(
      () =>
        runPromoteBuilding(
          {
            lookupLocal: async () => lookup({ base: baseCandidate }),
            promoteViaApi: async () => {
              throw new Error("backend down");
            },
            syncBuildingsCore: async () => {
              synced = true;
              return { ok: true, detail: "ok" };
            },
            verifyResolvedSource: async () => "core",
          },
          CONTROLLED_TEST_FEATURE_KEY
        ),
      (error: unknown) => error instanceof PromoteBuildingError && error.code === "api_failure"
    );
    assert.equal(synced, false);
  });

  it("Core write success with sync failure reports stale local cache", async () => {
    const result = await runPromoteBuilding(
      {
        lookupLocal: async () => lookup({ base: baseCandidate }),
        promoteViaApi: async () => ({
          feature_key: CONTROLLED_TEST_FEATURE_KEY,
          local_source: "base",
          operation: "created",
          core_id: "101",
          public_id: "00000000-0000-0000-0000-000000000101",
        }),
        syncBuildingsCore: async () => ({ ok: false, detail: "timeout" }),
        verifyResolvedSource: async () => {
          throw new Error("should not verify after sync failure");
        },
      },
      CONTROLLED_TEST_FEATURE_KEY
    );
    assert.equal(result.exitCode, 3);
    assert.match(result.output, /Core write succeeded but local buildings_core refresh failed/);
    assert.match(result.output, /sync result: failed: timeout/);
  });
});
