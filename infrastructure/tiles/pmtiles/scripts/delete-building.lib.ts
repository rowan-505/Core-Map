import { parseBuildingPromoteFeatureKey, type BuildingOsmIdentity } from "./promote-building.lib.ts";

export const CONTROLLED_TEST_DELETE_BUILDING_FEATURE_KEY = "osm:way:9100000001";

export class DeleteBuildingError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode: number) {
    super(message);
    this.name = "DeleteBuildingError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function parseDeleteBuildingFeatureKey(raw: string | undefined): BuildingOsmIdentity {
  try {
    return parseBuildingPromoteFeatureKey(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DeleteBuildingError("invalid_feature_key", message, 1);
  }
}

export function requireDeleteConfirmation(argv: string[]): void {
  if (!argv.includes("--confirm-delete")) {
    throw new DeleteBuildingError(
      "confirm_required",
      "DELETE removes the feature from the map (Base and Archive will not render). Re-run with --confirm-delete.",
      1
    );
  }
}

export function formatDeleteResult(args: {
  featureKey: string;
  suppressionWrite: string;
  coreRemoval: string;
  sync: string;
  resolved: string;
}): string {
  return [
    `feature_key: ${args.featureKey}`,
    `suppression write: ${args.suppressionWrite}`,
    `Core removal: ${args.coreRemoval}`,
    `sync: ${args.sync}`,
    `resolved: ${args.resolved}`,
  ].join("\n");
}

export type DeleteBuildingDeps = {
  writeSuppression: (featureKey: string) => Promise<{ created: boolean; core_removed: boolean }>;
  sync: () => Promise<{ ok: boolean; detail: string }>;
  verifyAbsent: (featureKey: string) => Promise<{ present: boolean; suppressed: boolean }>;
};

export async function runDeleteBuilding(
  deps: DeleteBuildingDeps,
  rawFeatureKey: string | undefined,
  argv: string[]
): Promise<{ output: string; exitCode: number }> {
  requireDeleteConfirmation(argv);
  const identity = parseDeleteBuildingFeatureKey(rawFeatureKey);

  let suppression: { created: boolean; core_removed: boolean };
  try {
    suppression = await deps.writeSuppression(identity.featureKey);
  } catch (error) {
    if (error instanceof DeleteBuildingError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/409|blocked|dependencies/i.test(message)) {
      throw new DeleteBuildingError("blocked", message, 1);
    }
    throw new DeleteBuildingError("api_failure", message, 2);
  }

  const sync = await deps.sync();
  if (!sync.ok) {
    const output = formatDeleteResult({
      featureKey: identity.featureKey,
      suppressionWrite: "PASS",
      coreRemoval: suppression.core_removed ? "PASS" : "SKIPPED",
      sync: "FAIL",
      resolved: "unknown",
    });
    return {
      output: `${output}\nSuppression was written but local refresh failed (stale cache): ${sync.detail}`,
      exitCode: 3,
    };
  }

  const local = await deps.verifyAbsent(identity.featureKey);
  if (local.present || !local.suppressed) {
    const output = formatDeleteResult({
      featureKey: identity.featureKey,
      suppressionWrite: "PASS",
      coreRemoval: suppression.core_removed ? "PASS" : "SKIPPED",
      sync: "PASS",
      resolved: local.present ? "still_visible" : "missing_suppression",
    });
    return {
      output: `${output}\nLocal verify failed: buildings_v still has the feature, or suppression cache is missing.`,
      exitCode: 3,
    };
  }

  return {
    output: formatDeleteResult({
      featureKey: identity.featureKey,
      suppressionWrite: suppression.created ? "PASS" : "PASS (idempotent)",
      coreRemoval: suppression.core_removed ? "PASS" : "SKIPPED",
      sync: "PASS",
      resolved: "absent",
    }),
    exitCode: 0,
  };
}
