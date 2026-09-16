import { osmIdentityKey } from "../../../../tools/data-pipeline/local-osm/source-identity.ts";
import { formatPromoteResult } from "./promote-building.lib.ts";

export const CONTROLLED_TEST_LAND_FEATURE_KEY = "osm:way:9200000001";

export type LocalSourceKind = "archive" | "base";

export type LandOsmIdentity = {
  featureKey: string;
  sourceFeatureType: "way" | "relation";
  sourceFeatureId: string;
};

export type LocalLandPromoteCandidate = {
  localSource: LocalSourceKind;
  classCode: string | null;
  name: string | null;
  nameMm: string | null;
  nameEn: string | null;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
};

export type PromoteLandApiResult = {
  feature_key: string;
  local_source: LocalSourceKind;
  operation: "created" | "existing" | "updated";
  core_id: string;
  public_id: string;
};

export class PromoteLandError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode: number) {
    super(message);
    this.name = "PromoteLandError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function parseLandPromoteFeatureKey(raw: string | undefined): LandOsmIdentity {
  const key = osmIdentityKey(raw ?? "");
  if (!key) {
    throw new PromoteLandError(
      "invalid_feature_key",
      "feature_key must be osm:way:<id> or osm:relation:<id> (osm:W:123 is accepted).",
      1
    );
  }
  const parts = key.split(":");
  const type = parts[1];
  const id = parts[2];
  if ((type !== "way" && type !== "relation") || !id) {
    throw new PromoteLandError(
      "invalid_feature_key",
      "Land areas can only be promoted from OSM ways or relations.",
      1
    );
  }
  return {
    featureKey: key,
    sourceFeatureType: type,
    sourceFeatureId: id,
  };
}

export type LocalLandLookup = {
  suppressed: boolean;
  archive: LocalLandPromoteCandidate | null;
  base: LocalLandPromoteCandidate | null;
};

export function resolveLocalLandPromoteCandidate(lookup: LocalLandLookup): LocalLandPromoteCandidate {
  if (lookup.suppressed) {
    throw new PromoteLandError(
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
  throw new PromoteLandError(
    "missing_feature",
    "Feature was not found in land_areas_archive or land_areas_base.",
    1
  );
}

export type PromoteLandDeps = {
  lookupLocal: (identity: LandOsmIdentity) => Promise<LocalLandLookup>;
  promoteViaApi: (payload: {
    feature_key: string;
    local_source: LocalSourceKind;
    geometry: LocalLandPromoteCandidate["geometry"];
    class_code: string;
    name?: string | null;
    name_mm?: string | null;
    name_en?: string | null;
  }) => Promise<PromoteLandApiResult>;
  syncLandAreasCore: () => Promise<{ ok: boolean; detail: string }>;
  verifyResolvedSource: (featureKey: string) => Promise<string | null>;
};

export async function runPromoteLand(
  deps: PromoteLandDeps,
  rawFeatureKey: string | undefined
): Promise<{ output: string; exitCode: number }> {
  const identity = parseLandPromoteFeatureKey(rawFeatureKey);
  const lookup = await deps.lookupLocal(identity);
  const local = resolveLocalLandPromoteCandidate(lookup);

  if (!local.geometry || (local.geometry.type !== "Polygon" && local.geometry.type !== "MultiPolygon")) {
    throw new PromoteLandError("invalid_geometry", "Local geometry is missing or not a polygon.", 1);
  }
  if (!local.classCode?.trim()) {
    throw new PromoteLandError(
      "invalid_class",
      "Local class_code is required so Core can resolve ref.ref_land_area_classes.",
      1
    );
  }

  let apiResult: PromoteLandApiResult;
  try {
    apiResult = await deps.promoteViaApi({
      feature_key: identity.featureKey,
      local_source: local.localSource,
      geometry: local.geometry,
      class_code: local.classCode,
      name: local.name,
      name_mm: local.nameMm,
      name_en: local.nameEn,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PromoteLandError("api_failure", message, 2);
  }

  const sync = await deps.syncLandAreasCore();
  if (!sync.ok) {
    const output = formatPromoteResult({
      featureKey: identity.featureKey,
      localSource: local.localSource,
      coreId: apiResult.core_id,
      operation: apiResult.operation,
      syncResult: `failed: ${sync.detail}`,
      resolvedSource: "unknown",
    });
    return { output: `${output}\nCore write succeeded but local land_areas_core refresh failed.`, exitCode: 3 };
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
      output: `${output}\nCore write succeeded but tile_source.land_areas_v did not resolve Core.`,
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
