import { parseLandPromoteFeatureKey, type LandOsmIdentity } from "./promote-land.lib.ts";
import { formatDeleteResult } from "./delete-building.lib.ts";

export { formatDeleteResult };

export const CONTROLLED_TEST_DELETE_LAND_FEATURE_KEY = "osm:way:9200000001";

export class DeleteLandError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode: number) {
    super(message);
    this.name = "DeleteLandError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function parseDeleteLandFeatureKey(raw: string | undefined): LandOsmIdentity {
  try {
    return parseLandPromoteFeatureKey(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DeleteLandError("invalid_feature_key", message, 1);
  }
}

export function requireLandDeleteConfirmation(argv: string[]): void {
  if (!argv.includes("--confirm-delete")) {
    throw new DeleteLandError(
      "confirm_required",
      "DELETE removes the feature from the map (Base and Archive will not render). Re-run with --confirm-delete.",
      1
    );
  }
}

export type DeleteLandDeps = {
  writeSuppression: (featureKey: string) => Promise<{ created: boolean; core_removed: boolean }>;
  sync: () => Promise<{ ok: boolean; detail: string }>;
  verifyAbsent: (featureKey: string) => Promise<{ present: boolean; suppressed: boolean }>;
};

export async function runDeleteLand(
  deps: DeleteLandDeps,
  rawFeatureKey: string | undefined,
  argv: string[]
): Promise<{ output: string; exitCode: number }> {
  requireLandDeleteConfirmation(argv);
  const identity = parseDeleteLandFeatureKey(rawFeatureKey);

  let suppression: { created: boolean; core_removed: boolean };
  try {
    suppression = await deps.writeSuppression(identity.featureKey);
  } catch (error) {
    if (error instanceof DeleteLandError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/409|blocked|dependencies/i.test(message)) {
      throw new DeleteLandError("blocked", message, 1);
    }
    throw new DeleteLandError("api_failure", message, 2);
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
      output: `${output}\nLocal verify failed: land_areas_v still has the feature, or suppression cache is missing.`,
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
