import { parseBuildingPromoteFeatureKey, type BuildingOsmIdentity } from "./promote-building.lib.ts";

export const CONTROLLED_TEST_DEMOTE_FEATURE_KEY = "osm:way:9100000001";

export type DemoteDependency = {
  code: string;
  count: number;
  message: string;
};

export type DemotePreflightPayload = {
  feature_key: string;
  core_id: string;
  public_id: string;
  class_code: string;
  name: string | null;
  name_mm: string | null;
  name_en: string | null;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
  core_snapshot: Record<string, unknown>;
};

export class DemoteBuildingError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly dependencies?: DemoteDependency[];

  constructor(code: string, message: string, exitCode: number, dependencies?: DemoteDependency[]) {
    super(message);
    this.name = "DemoteBuildingError";
    this.code = code;
    this.exitCode = exitCode;
    this.dependencies = dependencies;
  }
}

export function parseDemoteBuildingFeatureKey(raw: string | undefined): BuildingOsmIdentity {
  try {
    return parseBuildingPromoteFeatureKey(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DemoteBuildingError("invalid_feature_key", message, 1);
  }
}

export function formatDemoteResult(args: {
  featureKey: string;
  previousCoreId: string;
  archiveWrite: string;
  coreRemoval: string;
  sync: string;
  resolvedSource: string;
}): string {
  return [
    `feature_key: ${args.featureKey}`,
    `previous Core id: ${args.previousCoreId}`,
    `archive write: ${args.archiveWrite}`,
    `Core removal: ${args.coreRemoval}`,
    `sync: ${args.sync}`,
    `resolved source: ${args.resolvedSource}`,
  ].join("\n");
}

export function verifyArchivePayload(payload: DemotePreflightPayload): void {
  if (!payload.feature_key.trim()) {
    throw new DemoteBuildingError("archive_invalid", "Archive feature_key is missing.", 1);
  }
  if (!payload.geometry || (payload.geometry.type !== "Polygon" && payload.geometry.type !== "MultiPolygon")) {
    throw new DemoteBuildingError("archive_invalid", "Archive geometry is missing or not a polygon.", 1);
  }
  if (!payload.class_code?.trim()) {
    throw new DemoteBuildingError("archive_invalid", "Archive class_code is missing.", 1);
  }
  const snapshot = payload.core_snapshot ?? {};
  if (!snapshot.public_id || !snapshot.geometry) {
    throw new DemoteBuildingError("archive_invalid", "Archive core_snapshot is missing public_id or geometry.", 1);
  }
}

export type DemoteBuildingDeps = {
  preflight: (featureKey: string) => Promise<DemotePreflightPayload>;
  writeArchive: (payload: DemotePreflightPayload) => Promise<void>;
  verifyArchive: (featureKey: string) => Promise<{ ok: boolean; reason?: string }>;
  removeCore: (featureKey: string) => Promise<{ core_id: string }>;
  syncBuildingsCore: () => Promise<{ ok: boolean; detail: string }>;
  verifyLocalState: (featureKey: string) => Promise<{
    coreActiveCount: number;
    archivePresent: boolean;
    resolvedSource: string | null;
  }>;
};

export async function runDemoteBuilding(
  deps: DemoteBuildingDeps,
  rawFeatureKey: string | undefined
): Promise<{ output: string; exitCode: number }> {
  const identity = parseDemoteBuildingFeatureKey(rawFeatureKey);

  let payload: DemotePreflightPayload;
  try {
    payload = await deps.preflight(identity.featureKey);
  } catch (error) {
    if (error instanceof DemoteBuildingError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/404|No active Core/i.test(message)) {
      throw new DemoteBuildingError("no_active_core", "No active Core building exists for this feature_key.", 1);
    }
    if (/409|blocked|dependencies/i.test(message)) {
      throw new DemoteBuildingError("blocked", message, 1);
    }
    throw new DemoteBuildingError("api_failure", message, 2);
  }

  verifyArchivePayload(payload);

  try {
    await deps.writeArchive(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DemoteBuildingError("archive_failure", message, 1);
  }

  const archiveCheck = await deps.verifyArchive(identity.featureKey);
  if (!archiveCheck.ok) {
    throw new DemoteBuildingError(
      "archive_invalid",
      archiveCheck.reason ?? "Archive verification failed.",
      1
    );
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

  const sync = await deps.syncBuildingsCore();
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
      output: `${output}\nCore removal succeeded but local buildings_core refresh failed (stale cache): ${sync.detail}`,
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
      output: `${output}\nLocal verify failed: buildings_v did not resolve Archive (or Core cache still has an active/tombstone row).`,
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
