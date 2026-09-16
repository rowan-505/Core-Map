import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONTROLLED_TEST_LAND_DEMOTE_FEATURE_KEY,
  DemoteLandError,
  parseDemoteLandFeatureKey,
  runDemoteLand,
  type DemotePreflightPayload,
} from "./demote-land.lib.ts";

const geometry: DemotePreflightPayload["geometry"] = {
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

const payload: DemotePreflightPayload = {
  feature_key: CONTROLLED_TEST_LAND_DEMOTE_FEATURE_KEY,
  core_id: "21",
  public_id: "22222222-2222-2222-2222-222222222222",
  class_code: "residential",
  name: "LAND_A_BASE",
  name_mm: null,
  name_en: "Residential",
  geometry,
  core_snapshot: {
    feature_key: CONTROLLED_TEST_LAND_DEMOTE_FEATURE_KEY,
    public_id: "22222222-2222-2222-2222-222222222222",
    geometry,
    class_code: "residential",
    land_area_class_id: "3",
    detail_level: "zone",
    crop_code: null,
    irrigated: null,
    seasonality: null,
  },
};

describe("parseDemoteLandFeatureKey", () => {
  it("accepts canonical and short OSM keys", () => {
    assert.equal(parseDemoteLandFeatureKey("osm:way:9200000001").featureKey, CONTROLLED_TEST_LAND_DEMOTE_FEATURE_KEY);
    assert.equal(parseDemoteLandFeatureKey("osm:W:9200000001").featureKey, CONTROLLED_TEST_LAND_DEMOTE_FEATURE_KEY);
  });

  it("rejects invalid feature_key", () => {
    assert.throws(() => parseDemoteLandFeatureKey("bad-key"), DemoteLandError);
  });
});

describe("runDemoteLand", () => {
  it("demotes Core to Archive for the controlled feature", async () => {
    let archived = false;
    let removed = false;
    const result = await runDemoteLand(
      {
        preflight: async () => payload,
        writeArchive: async () => {
          archived = true;
        },
        verifyArchive: async () => ({ ok: true }),
        removeCore: async () => {
          removed = true;
          return { core_id: "21" };
        },
        syncLandAreasCore: async () => ({ ok: true, detail: "ok" }),
        verifyLocalState: async () => ({
          coreActiveCount: 0,
          archivePresent: true,
          resolvedSource: "archive",
        }),
      },
      CONTROLLED_TEST_LAND_DEMOTE_FEATURE_KEY
    );
    assert.equal(result.exitCode, 0);
    assert.equal(archived, true);
    assert.equal(removed, true);
    assert.match(result.output, /archive write: PASS/);
    assert.match(result.output, /Core removal: PASS/);
    assert.match(result.output, /resolved source: Archive/);
  });

  it("stops before archive when Core is missing", async () => {
    let archived = false;
    await assert.rejects(
      () =>
        runDemoteLand(
          {
            preflight: async () => {
              throw new DemoteLandError("no_active_core", "No active Core land area exists for this feature_key.", 1);
            },
            writeArchive: async () => {
              archived = true;
            },
            verifyArchive: async () => ({ ok: true }),
            removeCore: async () => ({ core_id: "21" }),
            syncLandAreasCore: async () => ({ ok: true, detail: "ok" }),
            verifyLocalState: async () => ({
              coreActiveCount: 0,
              archivePresent: false,
              resolvedSource: null,
            }),
          },
          CONTROLLED_TEST_LAND_DEMOTE_FEATURE_KEY
        ),
      (error: unknown) => error instanceof DemoteLandError && error.code === "no_active_core"
    );
    assert.equal(archived, false);
  });

  it("blocks dependencies without writing Archive or Core", async () => {
    let archived = false;
    let removed = false;
    await assert.rejects(
      () =>
        runDemoteLand(
          {
            preflight: async () => {
              throw new DemoteLandError("blocked", "import-review candidates", 1);
            },
            writeArchive: async () => {
              archived = true;
            },
            verifyArchive: async () => ({ ok: true }),
            removeCore: async () => {
              removed = true;
              return { core_id: "21" };
            },
            syncLandAreasCore: async () => ({ ok: true, detail: "ok" }),
            verifyLocalState: async () => ({
              coreActiveCount: 1,
              archivePresent: false,
              resolvedSource: "core",
            }),
          },
          CONTROLLED_TEST_LAND_DEMOTE_FEATURE_KEY
        ),
      (error: unknown) => error instanceof DemoteLandError && error.code === "blocked"
    );
    assert.equal(archived, false);
    assert.equal(removed, false);
  });

  it("does not remove Core when Archive write fails", async () => {
    let removed = false;
    await assert.rejects(
      () =>
        runDemoteLand(
          {
            preflight: async () => payload,
            writeArchive: async () => {
              throw new Error("local db down");
            },
            verifyArchive: async () => ({ ok: true }),
            removeCore: async () => {
              removed = true;
              return { core_id: "21" };
            },
            syncLandAreasCore: async () => ({ ok: true, detail: "ok" }),
            verifyLocalState: async () => ({
              coreActiveCount: 1,
              archivePresent: false,
              resolvedSource: "core",
            }),
          },
          CONTROLLED_TEST_LAND_DEMOTE_FEATURE_KEY
        ),
      (error: unknown) => error instanceof DemoteLandError && error.code === "archive_failure"
    );
    assert.equal(removed, false);
  });

  it("keeps Archive and skips sync when Core removal fails", async () => {
    let synced = false;
    const result = await runDemoteLand(
      {
        preflight: async () => payload,
        writeArchive: async () => undefined,
        verifyArchive: async () => ({ ok: true }),
        removeCore: async () => {
          throw new Error("backend down");
        },
        syncLandAreasCore: async () => {
          synced = true;
          return { ok: true, detail: "ok" };
        },
        verifyLocalState: async () => ({
          coreActiveCount: 1,
          archivePresent: true,
          resolvedSource: "core",
        }),
      },
      CONTROLLED_TEST_LAND_DEMOTE_FEATURE_KEY
    );
    assert.equal(result.exitCode, 2);
    assert.equal(synced, false);
    assert.match(result.output, /archive write: PASS/);
    assert.match(result.output, /Core removal: FAIL/);
    assert.match(result.output, /Core still wins/);
  });

  it("reports stale cache when sync fails after Core removal", async () => {
    const result = await runDemoteLand(
      {
        preflight: async () => payload,
        writeArchive: async () => undefined,
        verifyArchive: async () => ({ ok: true }),
        removeCore: async () => ({ core_id: "21" }),
        syncLandAreasCore: async () => ({ ok: false, detail: "timeout" }),
        verifyLocalState: async () => ({
          coreActiveCount: 0,
          archivePresent: true,
          resolvedSource: "archive",
        }),
      },
      CONTROLLED_TEST_LAND_DEMOTE_FEATURE_KEY
    );
    assert.equal(result.exitCode, 3);
    assert.match(result.output, /stale cache/);
    assert.match(result.output, /sync: FAIL/);
  });
});
