import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

import {
  parseBuildingPromoteFeatureKey,
  PromoteBuildingError,
  runPromoteBuilding,
  type BuildingOsmIdentity,
  type LocalLookup,
  type LocalPromoteCandidate,
  type PromoteApiResult,
} from "./promote-building.lib.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
dotenv.config({ path: resolve(repoRoot, ".env") });
dotenv.config({ path: resolve(repoRoot, "apps/api/.env") });

const GEOM_SQL = `ST_AsGeoJSON(
  ST_Multi(
    ST_CollectionExtract(
      ST_MakeValid(ST_Force2D(ST_SetSRID(geom, 4326))),
      3
    )
  )
)::json`;

function cleanPgUrl(raw: string): string {
  const u = new URL(raw);
  for (const key of ["pgbouncer", "connection_limit", "pool_timeout", "schema"]) {
    u.searchParams.delete(key);
  }
  return u.toString();
}

function apiBaseUrl(): string {
  return (
    process.env.COREMAP_API_BASE_URL?.trim() ||
    process.env.VITE_API_BASE_URL?.trim() ||
    "http://localhost:3001"
  ).replace(/\/$/, "");
}

async function lookupLocal(client: pg.Client, identity: BuildingOsmIdentity): Promise<LocalLookup> {
  const tomb = await client.query<{ suppressed: boolean }>(
    `SELECT TRUE AS suppressed
     WHERE EXISTS (
       SELECT 1
       FROM tile_source.buildings_core
       WHERE feature_key = $1
         AND deleted_at IS NOT NULL
     )
        OR EXISTS (
       SELECT 1
       FROM tile_source.buildings_suppressed
       WHERE feature_key = $1
     )`,
    [identity.featureKey]
  );

  const archive = await client.query<{
    class_code: string | null;
    name: string | null;
    name_mm: string | null;
    name_en: string | null;
    geometry: LocalPromoteCandidate["geometry"] | null;
  }>(
    `SELECT DISTINCT ON (feature_key)
        class_code,
        name,
        name_mm,
        name_en,
        ${GEOM_SQL} AS geometry
     FROM tile_source.buildings_archive
     WHERE feature_key = $1
       AND geom IS NOT NULL
       AND NOT ST_IsEmpty(geom)
     ORDER BY feature_key, demoted_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [identity.featureKey]
  );

  const base = await client.query<{
    class_code: string | null;
    name: string | null;
    geometry: LocalPromoteCandidate["geometry"] | null;
  }>(
    `SELECT
        class_code,
        canonical_name AS name,
        ${GEOM_SQL} AS geometry
     FROM tile_source.buildings_base
     WHERE osm_feature_type = $1
       AND osm_id = $2::bigint
       AND geom IS NOT NULL
       AND NOT ST_IsEmpty(geom)
     LIMIT 1`,
    [identity.sourceFeatureType, identity.sourceFeatureId]
  );

  const toCandidate = (
    localSource: "archive" | "base",
    row:
      | {
          class_code: string | null;
          name: string | null;
          name_mm?: string | null;
          name_en?: string | null;
          geometry: LocalPromoteCandidate["geometry"] | null;
        }
      | undefined
  ): LocalPromoteCandidate | null => {
    if (!row?.geometry) {
      return null;
    }
    return {
      localSource,
      classCode: row.class_code,
      name: row.name,
      nameMm: row.name_mm ?? null,
      nameEn: row.name_en ?? null,
      geometry: row.geometry,
    };
  };

  return {
    suppressed: tomb.rows.length > 0,
    archive: toCandidate("archive", archive.rows[0]),
    base: toCandidate("base", base.rows[0]),
  };
}

async function loginAccessToken(): Promise<string | null> {
  const preset = process.env.COREMAP_ACCESS_TOKEN?.trim();
  if (preset) {
    return preset;
  }
  if (process.env.AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production") {
    return null;
  }
  const email = process.env.COREMAP_ADMIN_EMAIL?.trim();
  const password = process.env.COREMAP_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new PromoteBuildingError(
      "config",
      "Set COREMAP_ACCESS_TOKEN or COREMAP_ADMIN_EMAIL + COREMAP_ADMIN_PASSWORD to call the Fastify admin API.",
      1
    );
  }
  const response = await fetch(`${apiBaseUrl()}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json().catch(() => null)) as { accessToken?: string; message?: string } | null;
  if (!response.ok || !body?.accessToken) {
    throw new PromoteBuildingError(
      "api_failure",
      `Admin login failed HTTP ${response.status}${body?.message ? `: ${body.message}` : ""}`,
      2
    );
  }
  return body.accessToken;
}

async function promoteViaApi(payload: {
  feature_key: string;
  local_source: "archive" | "base";
  geometry: LocalPromoteCandidate["geometry"];
  class_code?: string;
  name?: string | null;
  name_mm?: string | null;
  name_en?: string | null;
}): Promise<PromoteApiResult> {
  const token = await loginAccessToken();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${apiBaseUrl()}/buildings/promote-from-source`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as
    | (PromoteApiResult & { message?: string })
    | null;
  if (!response.ok || !body?.core_id || !body.operation) {
    throw new Error(
      `Promote API failed HTTP ${response.status}${body?.message ? `: ${body.message}` : ""}`
    );
  }
  return {
    feature_key: body.feature_key,
    local_source: body.local_source,
    operation: body.operation,
    core_id: body.core_id,
    public_id: body.public_id,
  };
}

function syncBuildingsCore(): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn("npm", ["run", "tiles:sync", "--", "buildings_core"], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", (error) => {
      resolvePromise({ ok: false, detail: error.message });
    });
    child.on("close", (code) => {
      resolvePromise({
        ok: code === 0,
        detail: code === 0 ? "ok" : out.trim().slice(-500) || `exit ${code}`,
      });
    });
  });
}

async function verifyResolvedSource(client: pg.Client, featureKey: string): Promise<string | null> {
  const result = await client.query<{ source: string }>(
    `SELECT source
     FROM tile_source.buildings_v
     WHERE feature_key = $1
     LIMIT 1`,
    [featureKey]
  );
  return result.rows[0]?.source ?? null;
}

async function main(): Promise<number> {
  const rawKey = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
  parseBuildingPromoteFeatureKey(rawKey);

  const localUrl = process.env.LOCAL_TILE_DATABASE_URL || process.env.COREMAP_TILES_DATABASE_URL;
  if (!localUrl) {
    throw new PromoteBuildingError("config", "LOCAL_TILE_DATABASE_URL is required.", 1);
  }

  const client = new pg.Client({ connectionString: cleanPgUrl(localUrl) });
  await client.connect();
  try {
    const result = await runPromoteBuilding(
      {
        lookupLocal: (identity) => lookupLocal(client, identity),
        promoteViaApi,
        syncBuildingsCore,
        verifyResolvedSource: (featureKey) => verifyResolvedSource(client, featureKey),
      },
      rawKey
    );
    console.log(result.output);
    return result.exitCode;
  } finally {
    await client.end();
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    if (error instanceof PromoteBuildingError) {
      console.error(`${error.code}: ${error.message}`);
      process.exit(error.exitCode);
    }
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
