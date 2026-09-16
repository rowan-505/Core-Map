import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONTROLLED_TEST_LAND_FEATURE_KEY,
  parseLandPromoteFeatureKey,
  PromoteLandError,
  resolveLocalLandPromoteCandidate,
  runPromoteLand,
  type LocalLandLookup,
  type LocalLandPromoteCandidate,
  type PromoteLandApiResult,
} from "./promote-land.lib.ts";

const geometry: LocalLandPromoteCandidate["geometry"] = {
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

const baseCandidate: LocalLandPromoteCandidate = {
  localSource: "base",
  classCode: "residential",
  name: "LAND_A_BASE",
  nameMm: null,
  nameEn: null,
  geometry,
};

const archiveCandidate: LocalLandPromoteCandidate = {
  localSource: "archive",
  classCode: "forest",
  name: "LAND_C_ARCHIVE",
  nameMm: "မ",
  nameEn: "Archive",
  geometry,
};

function lookup(partial: Partial<LocalLandLookup>): LocalLandLookup {
  return {
    suppressed: false,
    archive: null,
    base: null,
    ...partial,
  };
}

describe("parseLandPromoteFeatureKey", () => {
  it("accepts canonical and legacy land keys", () => {
    assert.equal(parseLandPromoteFeatureKey("osm:way:123").featureKey, "osm:way:123");
    assert.equal(parseLandPromoteFeatureKey("osm:W:123").featureKey, "osm:way:123");
    assert.equal(parseLandPromoteFeatureKey("osm:relation:9").sourceFeatureType, "relation");
  });

  it("rejects invalid feature_key", () => {
    assert.throws(() => parseLandPromoteFeatureKey("not-a-key"), PromoteLandError);
    assert.throws(() => parseLandPromoteFeatureKey("osm:node:1"), PromoteLandError);
  });
});

describe("resolveLocalLandPromoteCandidate", () => {
  it("prefers archive over base", () => {
    const chosen = resolveLocalLandPromoteCandidate(lookup({ archive: archiveCandidate, base: baseCandidate }));
    assert.equal(chosen.localSource, "archive");
  });

  it("uses base when archive is absent", () => {
    const chosen = resolveLocalLandPromoteCandidate(lookup({ base: baseCandidate }));
    assert.equal(chosen.localSource, "base");
  });

  it("fails when missing", () => {
    assert.throws(() => resolveLocalLandPromoteCandidate(lookup({})), /not found/);
  });
});

describe("runPromoteLand", () => {
  it("Base -> Promote", async () => {
    let apiCalled = 0;
    const result = await runPromoteLand(
      {
        lookupLocal: async () => lookup({ base: baseCandidate }),
        promoteViaApi: async (payload) => {
          apiCalled += 1;
          assert.equal(payload.local_source, "base");
          assert.equal(payload.feature_key, CONTROLLED_TEST_LAND_FEATURE_KEY);
          assert.equal(payload.class_code, "residential");
          return {
            feature_key: CONTROLLED_TEST_LAND_FEATURE_KEY,
            local_source: "base",
            operation: "created",
            core_id: "201",
            public_id: "00000000-0000-0000-0000-000000000201",
          } satisfies PromoteLandApiResult;
        },
        syncLandAreasCore: async () => ({ ok: true, detail: "ok" }),
        verifyResolvedSource: async () => "core",
      },
      CONTROLLED_TEST_LAND_FEATURE_KEY
    );
    assert.equal(result.exitCode, 0);
    assert.equal(apiCalled, 1);
    assert.match(result.output, /local source used: base/);
    assert.match(result.output, /operation: created/);
    assert.match(result.output, /resolved source: Core/);
  });

  it("Archive -> Promote", async () => {
    const result = await runPromoteLand(
      {
        lookupLocal: async () => lookup({ archive: archiveCandidate, base: baseCandidate }),
        promoteViaApi: async (payload) => {
          assert.equal(payload.local_source, "archive");
          assert.equal(payload.class_code, "forest");
          return {
            feature_key: CONTROLLED_TEST_LAND_FEATURE_KEY,
            local_source: "archive",
            operation: "updated",
            core_id: "202",
            public_id: "00000000-0000-0000-0000-000000000202",
          };
        },
        syncLandAreasCore: async () => ({ ok: true, detail: "ok" }),
        verifyResolvedSource: async () => "core",
      },
      CONTROLLED_TEST_LAND_FEATURE_KEY
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /local source used: archive/);
    assert.match(result.output, /operation: updated/);
  });

  it("already Core -> no duplicate", async () => {
    let apiCalled = 0;
    const result = await runPromoteLand(
      {
        lookupLocal: async () => lookup({ base: baseCandidate }),
        promoteViaApi: async () => {
          apiCalled += 1;
          return {
            feature_key: CONTROLLED_TEST_LAND_FEATURE_KEY,
            local_source: "base",
            operation: "existing",
            core_id: "201",
            public_id: "00000000-0000-0000-0000-000000000201",
          };
        },
        syncLandAreasCore: async () => ({ ok: true, detail: "ok" }),
        verifyResolvedSource: async () => "core",
      },
      CONTROLLED_TEST_LAND_FEATURE_KEY
    );
    assert.equal(apiCalled, 1);
    assert.match(result.output, /operation: existing/);
  });

  it("invalid feature_key", async () => {
    await assert.rejects(
      () =>
        runPromoteLand(
          {
            lookupLocal: async () => lookup({}),
            promoteViaApi: async () => {
              throw new Error("should not call API");
            },
            syncLandAreasCore: async () => ({ ok: true, detail: "ok" }),
            verifyResolvedSource: async () => "core",
          },
          "bad-key"
        ),
      (error: unknown) => error instanceof PromoteLandError && error.code === "invalid_feature_key"
    );
  });

  it("missing feature", async () => {
    await assert.rejects(
      () =>
        runPromoteLand(
          {
            lookupLocal: async () => lookup({}),
            promoteViaApi: async () => {
              throw new Error("should not call API");
            },
            syncLandAreasCore: async () => ({ ok: true, detail: "ok" }),
            verifyResolvedSource: async () => "core",
          },
          CONTROLLED_TEST_LAND_FEATURE_KEY
        ),
      (error: unknown) => error instanceof PromoteLandError && error.code === "missing_feature"
    );
  });

  it("API failure does not sync", async () => {
    let synced = false;
    await assert.rejects(
      () =>
        runPromoteLand(
          {
            lookupLocal: async () => lookup({ base: baseCandidate }),
            promoteViaApi: async () => {
              throw new Error("backend down");
            },
            syncLandAreasCore: async () => {
              synced = true;
              return { ok: true, detail: "ok" };
            },
            verifyResolvedSource: async () => "core",
          },
          CONTROLLED_TEST_LAND_FEATURE_KEY
        ),
      (error: unknown) => error instanceof PromoteLandError && error.code === "api_failure"
    );
    assert.equal(synced, false);
  });

  it("Core write success with sync failure reports stale local cache", async () => {
    const result = await runPromoteLand(
      {
        lookupLocal: async () => lookup({ base: baseCandidate }),
        promoteViaApi: async () => ({
          feature_key: CONTROLLED_TEST_LAND_FEATURE_KEY,
          local_source: "base",
          operation: "created",
          core_id: "201",
          public_id: "00000000-0000-0000-0000-000000000201",
        }),
        syncLandAreasCore: async () => ({ ok: false, detail: "timeout" }),
        verifyResolvedSource: async () => {
          throw new Error("should not verify after sync failure");
        },
      },
      CONTROLLED_TEST_LAND_FEATURE_KEY
    );
    assert.equal(result.exitCode, 3);
    assert.match(result.output, /Core write succeeded but local land_areas_core refresh failed/);
    assert.match(result.output, /sync result: failed: timeout/);
  });
});
