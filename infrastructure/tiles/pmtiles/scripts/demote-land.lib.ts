import { parseLandPromoteFeatureKey, type LandOsmIdentity } from "./promote-land.lib.ts";
import {
  formatDemoteResult,
  type DemoteDependency,
  type DemotePreflightPayload,
} from "./demote-building.lib.ts";

export { formatDemoteResult };
export type { DemoteDependency, DemotePreflightPayload };

export const CONTROLLED_TEST_LAND_DEMOTE_FEATURE_KEY = "osm:way:9200000001";

export class DemoteLandError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly dependencies?: DemoteDependency[];

  constructor(code: string, message: string, exitCode: number, dependencies?: DemoteDependency[]) {
    super(message);
    this.name = "DemoteLandError";
    this.code = code;
    this.exitCode = exitCode;
    this.dependencies = dependencies;
  }
}

export function parseDemoteLandFeatureKey(raw: string | undefined): LandOsmIdentity {
  try {
    return parseLandPromoteFeatureKey(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DemoteLandError("invalid_feature_key", message, 1);
  }
}

export function verifyLandArchivePayload(payload: DemotePreflightPayload): void {
  if (!payload.feature_key.trim()) {
    throw new DemoteLandError("archive_invalid", "Archive feature_key is missing.", 1);
  }
  if (!payload.geometry || (payload.geometry.type !== "Polygon" && payload.geometry.type !== "MultiPolygon")) {
    throw new DemoteLandError("archive_invalid", "Archive geometry is missing or not a polygon.", 1);
  }
  if (!payload.class_code?.trim()) {
    throw new DemoteLandError("archive_invalid", "Archive class_code is missing.", 1);
  }
  const snapshot = payload.core_snapshot ?? {};
  if (!snapshot.public_id || !snapshot.geometry) {
    throw new DemoteLandError("archive_invalid", "Archive core_snapshot is missing public_id or geometry.", 1);
  }
  if (!snapshot.land_area_class_id || !snapshot.detail_level) {
    throw new DemoteLandError(
      "archive_invalid",
      "Archive core_snapshot is missing land_area_class_id or detail_level.",
      1
    );
  }
}

export type DemoteLandDeps = {
  preflight: (featureKey: string) => Promise<DemotePreflightPayload>;
  writeArchive: (payload: DemotePreflightPayload) => Promise<void>;
  verifyArchive: (featureKey: string) => Promise<{ ok: boolean; reason?: string }>;
  removeCore: (featureKey: string) => Promise<{ core_id: string }>;
  syncLandAreasCore: () => Promise<{ ok: boolean; detail: string }>;
  verifyLocalState: (featureKey: string) => Promise<{
    coreActiveCount: number;
    archivePresent: boolean;
    resolvedSource: string | null;
  }>;
};

export async function runDemoteLand(
  deps: DemoteLandDeps,
  rawFeatureKey: string | undefined
): Promise<{ output: string; exitCode: number }> {
  const identity = parseDemoteLandFeatureKey(rawFeatureKey);

  let payload: DemotePreflightPayload;
  try {
    payload = await deps.preflight(identity.featureKey);
  } catch (error) {
    if (error instanceof DemoteLandError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/404|No active Core/i.test(message)) {
      throw new DemoteLandError("no_active_core", "No active Core land area exists for this feature_key.", 1);
    }
    if (/409|blocked|dependencies/i.test(message)) {
      throw new DemoteLandError("blocked", message, 1);
    }
    throw new DemoteLandError("api_failure", message, 2);
  }

  verifyLandArchivePayload(payload);

  try {
    await deps.writeArchive(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DemoteLandError("archive_failure", message, 1);
  }

  const archiveCheck = await deps.verifyArchive(identity.featureKey);
  if (!archiveCheck.ok) {
    throw new DemoteLandError("archive_invalid", archiveCheck.reason ?? "Archive verification failed.", 1);
  }

  let removedCoreId = payload.core_id;
  try {
    const removed = await deps.removeCore(identity.featureKey);
    removedCoreId = removed.core_id || removedCoreId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const output = formatDemoteResult({
      featureKey: identity.featureKey,
      previousCoreId: payload.core_id,
      archiveWrite: "PASS",
      coreRemoval: "FAIL",
      sync: "SKIPPED",
      resolvedSource: "Core",
    });
    return {
      output: `${output}\nCore removal failed; Archive was kept. Core still wins.\n${message}`,
      exitCode: 2,
    };
  }

  const sync = await deps.syncLandAreasCore();
  if (!sync.ok) {
    const output = formatDemoteResult({
      featureKey: identity.featureKey,
      previousCoreId: removedCoreId,
      archiveWrite: "PASS",
      coreRemoval: "PASS",
      sync: "FAIL",
      resolvedSource: "unknown",
    });
    return {
      output: `${output}\nCore removal succeeded but local land_areas_core refresh failed (stale cache): ${sync.detail}`,
      exitCode: 3,
    };
  }

  const local = await deps.verifyLocalState(identity.featureKey);
  if (local.coreActiveCount > 0 || !local.archivePresent || local.resolvedSource !== "archive") {
    const output = formatDemoteResult({
      featureKey: identity.featureKey,
      previousCoreId: removedCoreId,
      archiveWrite: "PASS",
      coreRemoval: "PASS",
      sync: "PASS",
      resolvedSource: local.resolvedSource ?? "missing",
    });
    return {
      output: `${output}\nLocal verify failed: land_areas_v did not resolve Archive (or Core cache still has an active/tombstone row).`,
      exitCode: 3,
    };
  }

  return {
    output: formatDemoteResult({
      featureKey: identity.featureKey,
      previousCoreId: removedCoreId,
      archiveWrite: "PASS",
      coreRemoval: "PASS",
      sync: "PASS",
      resolvedSource: "Archive",
    }),
    exitCode: 0,
  };
}
