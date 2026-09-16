import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

import {
  DemoteBuildingError,
  parseDemoteBuildingFeatureKey,
  runDemoteBuilding,
  type DemotePreflightPayload,
} from "./demote-building.lib.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
dotenv.config({ path: resolve(repoRoot, ".env") });
dotenv.config({ path: resolve(repoRoot, "apps/api/.env") });

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
    throw new DemoteBuildingError(
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
    throw new DemoteBuildingError(
      "api_failure",
      `Admin login failed HTTP ${response.status}${body?.message ? `: ${body.message}` : ""}`,
      2
    );
  }
  return body.accessToken;
}

async function adminPost(path: string, payload: unknown): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const token = await loginAccessToken();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: response.status, body };
}

async function preflight(featureKey: string): Promise<DemotePreflightPayload> {
  const { status, body } = await adminPost("/buildings/demote-preflight", { feature_key: featureKey });
  if (status === 404) {
    throw new DemoteBuildingError("no_active_core", "No active Core building exists for this feature_key.", 1);
  }
  if (status === 409) {
    const dependencies = Array.isArray(body?.dependencies) ? JSON.stringify(body.dependencies) : "";
    throw new DemoteBuildingError(
      "blocked",
      `${String(body?.message ?? "Demotion blocked.")}${dependencies ? `\n${dependencies}` : ""}`,
      1
    );
  }
  if (status !== 200 || !body?.core_id || !body.geometry || !body.core_snapshot) {
    throw new DemoteBuildingError(
      "api_failure",
      `Demote preflight failed HTTP ${status}${body?.message ? `: ${String(body.message)}` : ""}`,
      2
    );
  }
  return {
    feature_key: String(body.feature_key),
    core_id: String(body.core_id),
    public_id: String(body.public_id),
    class_code: String(body.class_code ?? "yes"),
    name: (body.name as string | null) ?? null,
    name_mm: (body.name_mm as string | null) ?? null,
    name_en: (body.name_en as string | null) ?? null,
    geometry: body.geometry as DemotePreflightPayload["geometry"],
    core_snapshot: body.core_snapshot as Record<string, unknown>,
  };
}

async function writeArchive(client: pg.Client, payload: DemotePreflightPayload): Promise<void> {
  const geomJson = JSON.stringify(payload.geometry);
  const snapshotJson = JSON.stringify(payload.core_snapshot);
  const updated = await client.query(
    `UPDATE tile_source.buildings_archive AS a
     SET
       core_id = $2::bigint,
       core_public_id = $3::uuid,
       class_code = $4,
       name = $5,
       name_mm = $6,
       name_en = $7,
       geom = ST_Multi(
         ST_CollectionExtract(
           ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($8::text), 4326))),
           3
         )
       )::geometry(MultiPolygon, 4326),
       is_active = TRUE,
       deleted_at = NULL,
       core_snapshot = $9::jsonb,
       demotion_reason = 'demote_to_local',
       demoted_at = now()
     WHERE a.id = (
       SELECT id
       FROM tile_source.buildings_archive
       WHERE feature_key = $1
       ORDER BY demoted_at DESC NULLS LAST, id DESC
       LIMIT 1
     )`,
    [
      payload.feature_key,
      payload.core_id,
      payload.public_id,
      payload.class_code,
      payload.name,
      payload.name_mm,
      payload.name_en,
      geomJson,
      snapshotJson,
    ]
  );
  if ((updated.rowCount ?? 0) > 0) {
    return;
  }
  await client.query(
    `INSERT INTO tile_source.buildings_archive (
       feature_key, core_id, core_public_id, class_code, name, name_mm, name_en,
       geom, is_active, deleted_at, core_snapshot, demotion_reason, demoted_at
     )
     VALUES (
       $1, $2::bigint, $3::uuid, $4, $5, $6, $7,
       ST_Multi(
         ST_CollectionExtract(
           ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($8::text), 4326))),
           3
         )
       )::geometry(MultiPolygon, 4326),
       TRUE, NULL, $9::jsonb, 'demote_to_local', now()
     )`,
    [
      payload.feature_key,
      payload.core_id,
      payload.public_id,
      payload.class_code,
      payload.name,
      payload.name_mm,
      payload.name_en,
      geomJson,
      snapshotJson,
    ]
  );
}

async function verifyArchive(client: pg.Client, featureKey: string): Promise<{ ok: boolean; reason?: string }> {
  const result = await client.query<{
    feature_key: string;
    geom_ok: boolean;
    class_ok: boolean;
    snapshot_ok: boolean;
  }>(
    `SELECT
       feature_key,
       (geom IS NOT NULL AND NOT ST_IsEmpty(geom) AND ST_IsValid(geom)) AS geom_ok,
       (NULLIF(btrim(class_code), '') IS NOT NULL) AS class_ok,
       (
         core_snapshot ? 'public_id'
         AND core_snapshot ? 'geometry'
         AND core_snapshot ? 'feature_key'
       ) AS snapshot_ok
     FROM tile_source.buildings_archive
     WHERE feature_key = $1
     ORDER BY demoted_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [featureKey]
  );
  const row = result.rows[0];
  if (!row) {
    return { ok: false, reason: "Archive row was not found after write." };
  }
  if (row.feature_key !== featureKey) {
    return { ok: false, reason: "Archive feature_key does not match." };
  }
  if (!row.geom_ok) {
    return { ok: false, reason: "Archive geometry is missing or invalid." };
  }
  if (!row.class_ok || !row.snapshot_ok) {
    return { ok: false, reason: "Archive required fields are missing." };
  }
  return { ok: true };
}

async function removeCore(featureKey: string): Promise<{ core_id: string }> {
  const { status, body } = await adminPost("/buildings/demote-from-core", { feature_key: featureKey });
  if (status !== 200 || !body?.removed || !body.core_id) {
    throw new Error(
      `Core removal failed HTTP ${status}${body?.message ? `: ${String(body.message)}` : ""}`
    );
  }
  return { core_id: String(body.core_id) };
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

async function verifyLocalState(
  client: pg.Client,
  featureKey: string
): Promise<{ coreActiveCount: number; archivePresent: boolean; resolvedSource: string | null }> {
  const core = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM tile_source.buildings_core
     WHERE feature_key = $1`,
    [featureKey]
  );
  const archive = await client.query<{ ok: boolean }>(
    `SELECT TRUE AS ok
     FROM tile_source.buildings_archive
     WHERE feature_key = $1
     LIMIT 1`,
    [featureKey]
  );
  const resolved = await client.query<{ source: string }>(
    `SELECT source
     FROM tile_source.buildings_v
     WHERE feature_key = $1
     LIMIT 1`,
    [featureKey]
  );
  return {
    coreActiveCount: Number(core.rows[0]?.count ?? 0),
    archivePresent: archive.rows.length > 0,
    resolvedSource: resolved.rows[0]?.source ?? null,
  };
}

async function main(): Promise<number> {
  const rawKey = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
  parseDemoteBuildingFeatureKey(rawKey);

  const localUrl = process.env.LOCAL_TILE_DATABASE_URL || process.env.COREMAP_TILES_DATABASE_URL;
  if (!localUrl) {
    throw new DemoteBuildingError("config", "LOCAL_TILE_DATABASE_URL is required.", 1);
  }

  const client = new pg.Client({ connectionString: cleanPgUrl(localUrl) });
  await client.connect();
  try {
    const result = await runDemoteBuilding(
      {
        preflight,
        writeArchive: (payload) => writeArchive(client, payload),
        verifyArchive: (featureKey) => verifyArchive(client, featureKey),
        removeCore,
        syncBuildingsCore,
        verifyLocalState: (featureKey) => verifyLocalState(client, featureKey),
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
    if (error instanceof DemoteBuildingError) {
      console.error(`${error.code}: ${error.message}`);
      process.exit(error.exitCode);
    }
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
