import { osmIdentityKey } from "../../../../tools/data-pipeline/local-osm/source-identity.ts";

export const CONTROLLED_TEST_FEATURE_KEY = "osm:way:9100000001";

export type LocalSourceKind = "archive" | "base";

export type BuildingOsmIdentity = {
  featureKey: string;
  sourceFeatureType: "way" | "relation";
  sourceFeatureId: string;
};

export type LocalPromoteCandidate = {
  localSource: LocalSourceKind;
  classCode: string | null;
  name: string | null;
  nameMm: string | null;
  nameEn: string | null;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
};

export type PromoteApiResult = {
  feature_key: string;
  local_source: LocalSourceKind;
  operation: "created" | "existing" | "updated";
  core_id: string;
  public_id: string;
};

export class PromoteBuildingError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode: number) {
    super(message);
    this.name = "PromoteBuildingError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function parseBuildingPromoteFeatureKey(raw: string | undefined): BuildingOsmIdentity {
  const key = osmIdentityKey(raw ?? "");
  if (!key) {
    throw new PromoteBuildingError(
      "invalid_feature_key",
      "feature_key must be osm:way:<id> or osm:relation:<id> (osm:W:123 is accepted).",
      1
    );
  }
  const parts = key.split(":");
  const type = parts[1];
  const id = parts[2];
  if ((type !== "way" && type !== "relation") || !id) {
    throw new PromoteBuildingError(
      "invalid_feature_key",
      "Buildings can only be promoted from OSM ways or relations.",
      1
    );
  }
  return {
    featureKey: key,
    sourceFeatureType: type,
    sourceFeatureId: id,
  };
}

export type LocalLookup = {
  suppressed: boolean;
  archive: LocalPromoteCandidate | null;
  base: LocalPromoteCandidate | null;
};

export function resolveLocalPromoteCandidate(lookup: LocalLookup): LocalPromoteCandidate {
  if (lookup.suppressed) {
    throw new PromoteBuildingError(
      "suppressed",
      "Feature is marked deleted or render-suppressed. Do not promote until suppression is cleared.",
      1
    );
  }
  if (lookup.archive) {
    return lookup.archive;
  }
  if (lookup.base) {
    return lookup.base;
  }
  throw new PromoteBuildingError("missing_feature", "Feature was not found in buildings_archive or buildings_base.", 1);
}

export function formatPromoteResult(args: {
  featureKey: string;
  localSource: LocalSourceKind;
  coreId: string;
  operation: string;
  syncResult: string;
  resolvedSource: string;
}): string {
  return [
    `feature_key: ${args.featureKey}`,
    `local source used: ${args.localSource}`,
    `Core id: ${args.coreId}`,
    `operation: ${args.operation}`,
    `sync result: ${args.syncResult}`,
    `resolved source: ${args.resolvedSource}`,
  ].join("\n");
}

export type PromoteBuildingDeps = {
  lookupLocal: (identity: BuildingOsmIdentity) => Promise<LocalLookup>;
  promoteViaApi: (payload: {
    feature_key: string;
    local_source: LocalSourceKind;
    geometry: LocalPromoteCandidate["geometry"];
    class_code?: string;
    name?: string | null;
    name_mm?: string | null;
    name_en?: string | null;
  }) => Promise<PromoteApiResult>;
  syncBuildingsCore: () => Promise<{ ok: boolean; detail: string }>;
  verifyResolvedSource: (featureKey: string) => Promise<string | null>;
};

export async function runPromoteBuilding(
  deps: PromoteBuildingDeps,
  rawFeatureKey: string | undefined
): Promise<{ output: string; exitCode: number }> {
  const identity = parseBuildingPromoteFeatureKey(rawFeatureKey);
  const lookup = await deps.lookupLocal(identity);
  const local = resolveLocalPromoteCandidate(lookup);

  if (!local.geometry || (local.geometry.type !== "Polygon" && local.geometry.type !== "MultiPolygon")) {
    throw new PromoteBuildingError("invalid_geometry", "Local geometry is missing or not a polygon.", 1);
  }

  let apiResult: PromoteApiResult;
  try {
    apiResult = await deps.promoteViaApi({
      feature_key: identity.featureKey,
      local_source: local.localSource,
      geometry: local.geometry,
      class_code: local.classCode ?? undefined,
      name: local.name,
      name_mm: local.nameMm,
      name_en: local.nameEn,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PromoteBuildingError("api_failure", message, 2);
  }

  const sync = await deps.syncBuildingsCore();
  if (!sync.ok) {
    const output = formatPromoteResult({
      featureKey: identity.featureKey,
      localSource: local.localSource,
      coreId: apiResult.core_id,
      operation: apiResult.operation,
      syncResult: `failed: ${sync.detail}`,
      resolvedSource: "unknown",
    });
    return { output: `${output}\nCore write succeeded but local buildings_core refresh failed.`, exitCode: 3 };
  }

  const resolved = await deps.verifyResolvedSource(identity.featureKey);
  if (resolved !== "core") {
    const output = formatPromoteResult({
      featureKey: identity.featureKey,
      localSource: local.localSource,
      coreId: apiResult.core_id,
      operation: apiResult.operation,
      syncResult: "ok",
      resolvedSource: resolved ?? "missing",
    });
    return {
      output: `${output}\nCore write succeeded but tile_source.buildings_v did not resolve Core.`,
      exitCode: 3,
    };
  }

  return {
    output: formatPromoteResult({
      featureKey: identity.featureKey,
      localSource: local.localSource,
      coreId: apiResult.core_id,
      operation: apiResult.operation,
      syncResult: "ok",
      resolvedSource: "Core",
    }),
    exitCode: 0,
  };
}
