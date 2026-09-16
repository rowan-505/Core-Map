import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONTROLLED_TEST_DELETE_BUILDING_FEATURE_KEY,
  DeleteBuildingError,
  requireDeleteConfirmation,
  runDeleteBuilding,
} from "./delete-building.lib.ts";

describe("requireDeleteConfirmation", () => {
  it("requires --confirm-delete", () => {
    assert.throws(() => requireDeleteConfirmation(["osm:way:1"]), DeleteBuildingError);
    requireDeleteConfirmation(["--confirm-delete", "osm:way:1"]);
  });
});

describe("runDeleteBuilding", () => {
  const argv = ["--confirm-delete", CONTROLLED_TEST_DELETE_BUILDING_FEATURE_KEY];

  it("hides the feature after suppression sync", async () => {
    const result = await runDeleteBuilding(
      {
        writeSuppression: async () => ({ created: true, core_removed: false }),
        sync: async () => ({ ok: true, detail: "ok" }),
        verifyAbsent: async () => ({ present: false, suppressed: true }),
      },
      CONTROLLED_TEST_DELETE_BUILDING_FEATURE_KEY,
      argv
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /resolved: absent/);
  });

  it("marks a second delete as idempotent", async () => {
    const result = await runDeleteBuilding(
      {
        writeSuppression: async () => ({ created: false, core_removed: false }),
        sync: async () => ({ ok: true, detail: "ok" }),
        verifyAbsent: async () => ({ present: false, suppressed: true }),
      },
      CONTROLLED_TEST_DELETE_BUILDING_FEATURE_KEY,
      argv
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /idempotent/);
  });

  it("does not write suppression without confirmation", async () => {
    let written = false;
    await assert.rejects(
      () =>
        runDeleteBuilding(
          {
            writeSuppression: async () => {
              written = true;
              return { created: true, core_removed: false };
            },
            sync: async () => ({ ok: true, detail: "ok" }),
            verifyAbsent: async () => ({ present: false, suppressed: true }),
          },
          CONTROLLED_TEST_DELETE_BUILDING_FEATURE_KEY,
          [CONTROLLED_TEST_DELETE_BUILDING_FEATURE_KEY]
        ),
      (error: unknown) => error instanceof DeleteBuildingError && error.code === "confirm_required"
    );
    assert.equal(written, false);
  });

  it("blocks dependencies without writing suppression", async () => {
    await assert.rejects(
      () =>
        runDeleteBuilding(
          {
            writeSuppression: async () => {
              throw new DeleteBuildingError("blocked", "place–building links", 1);
            },
            sync: async () => ({ ok: true, detail: "ok" }),
            verifyAbsent: async () => ({ present: true, suppressed: false }),
          },
          CONTROLLED_TEST_DELETE_BUILDING_FEATURE_KEY,
          argv
        ),
      (error: unknown) => error instanceof DeleteBuildingError && error.code === "blocked"
    );
  });

  it("suppression write failure exits non-zero before sync", async () => {
    let synced = false;
    await assert.rejects(
      () =>
        runDeleteBuilding(
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
          CONTROLLED_TEST_DELETE_BUILDING_FEATURE_KEY,
          argv
        ),
      (error: unknown) =>
        error instanceof DeleteBuildingError && error.code === "api_failure" && error.exitCode === 2
    );
    assert.equal(synced, false);
  });

  it("reports stale cache when sync fails after suppression write", async () => {
    const result = await runDeleteBuilding(
      {
        writeSuppression: async () => ({ created: true, core_removed: true }),
        sync: async () => ({ ok: false, detail: "timeout" }),
        verifyAbsent: async () => {
          throw new Error("should not verify after sync failure");
        },
      },
      CONTROLLED_TEST_DELETE_BUILDING_FEATURE_KEY,
      argv
    );
    assert.equal(result.exitCode, 3);
    assert.match(result.output, /Suppression was written but local refresh failed \(stale cache\)/);
    assert.match(result.output, /sync: FAIL/);
  });
});
