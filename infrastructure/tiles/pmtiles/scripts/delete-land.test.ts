import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONTROLLED_TEST_DELETE_LAND_FEATURE_KEY,
  DeleteLandError,
  requireLandDeleteConfirmation,
  runDeleteLand,
} from "./delete-land.lib.ts";

describe("requireLandDeleteConfirmation", () => {
  it("requires --confirm-delete", () => {
    assert.throws(() => requireLandDeleteConfirmation(["osm:way:1"]), DeleteLandError);
    requireLandDeleteConfirmation(["--confirm-delete", "osm:way:1"]);
  });
});

describe("runDeleteLand", () => {
  const argv = ["--confirm-delete", CONTROLLED_TEST_DELETE_LAND_FEATURE_KEY];

  it("hides the feature after suppression sync", async () => {
    const result = await runDeleteLand(
      {
        writeSuppression: async () => ({ created: true, core_removed: true }),
        sync: async () => ({ ok: true, detail: "ok" }),
        verifyAbsent: async () => ({ present: false, suppressed: true }),
      },
      CONTROLLED_TEST_DELETE_LAND_FEATURE_KEY,
      argv
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /resolved: absent/);
    assert.match(result.output, /Core removal: PASS/);
  });

  it("does not write suppression without confirmation", async () => {
    let written = false;
    await assert.rejects(
      () =>
        runDeleteLand(
          {
            writeSuppression: async () => {
              written = true;
              return { created: true, core_removed: false };
            },
            sync: async () => ({ ok: true, detail: "ok" }),
            verifyAbsent: async () => ({ present: false, suppressed: true }),
          },
          CONTROLLED_TEST_DELETE_LAND_FEATURE_KEY,
          [CONTROLLED_TEST_DELETE_LAND_FEATURE_KEY]
        ),
      (error: unknown) => error instanceof DeleteLandError && error.code === "confirm_required"
    );
    assert.equal(written, false);
  });

  it("suppression write failure exits non-zero before sync", async () => {
    let synced = false;
    await assert.rejects(
      () =>
        runDeleteLand(
          {
            writeSuppression: async () => {
              throw new Error("backend down");
            },
            sync: async () => {
              synced = true;
              return { ok: true, detail: "ok" };
            },
            verifyAbsent: async () => ({ present: true, suppressed: false }),
          },
          CONTROLLED_TEST_DELETE_LAND_FEATURE_KEY,
          argv
        ),
      (error: unknown) =>
        error instanceof DeleteLandError && error.code === "api_failure" && error.exitCode === 2
    );
    assert.equal(synced, false);
  });

  it("reports stale cache when sync fails after suppression write", async () => {
    const result = await runDeleteLand(
      {
        writeSuppression: async () => ({ created: true, core_removed: true }),
        sync: async () => ({ ok: false, detail: "timeout" }),
        verifyAbsent: async () => {
          throw new Error("should not verify after sync failure");
        },
      },
      CONTROLLED_TEST_DELETE_LAND_FEATURE_KEY,
      argv
    );
    assert.equal(result.exitCode, 3);
    assert.match(result.output, /Suppression was written but local refresh failed \(stale cache\)/);
    assert.match(result.output, /sync: FAIL/);
  });
});
