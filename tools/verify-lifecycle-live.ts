/**
 * Live verification for building/land promote, demote, delete (CLI + both DBs).
 */
import { spawn } from "node:child_process";
import dotenv from "dotenv";
import { resolve } from "node:path";
import pg from "pg";

const repoRoot = resolve(import.meta.dirname, "..");
dotenv.config({ path: resolve(repoRoot, ".env") });
dotenv.config({ path: resolve(repoRoot, "apps/api/.env") });

const BUILDING_KEY = "osm:way:9100000001";
const LAND_KEY = "osm:way:9200000001";
const GEOM_WKT =
  "MULTIPOLYGON(((96.0 16.0, 96.0 16.001, 96.001 16.001, 96.001 16.0, 96.0 16.0)))";

type Row = { step: string; check: string; result: "PASS" | "FAIL"; detail: string };
const rows: Row[] = [];

function record(step: string, check: string, ok: boolean, detail: string) {
  rows.push({ step, check, result: ok ? "PASS" : "FAIL", detail });
}

function cleanPgUrl(raw: string): string {
  const u = new URL(raw);
  for (const key of ["pgbouncer", "connection_limit", "pool_timeout", "schema"]) {
    u.searchParams.delete(key);
  }
  return u.toString();
}

function localUrl(): string {
  const raw = (process.env.LOCAL_TILE_DATABASE_URL ?? "").replace(/^'|'$/g, "");
  if (!raw) throw new Error("LOCAL_TILE_DATABASE_URL missing");
  return cleanPgUrl(raw);
}

function supabaseUrl(): string {
  let raw = process.env.DATABASE_URL ?? process.env.SUPABASE_DATABASE_URL ?? "";
  if (!raw) throw new Error("DATABASE_URL missing");
  raw = raw.replace(":6543/", ":5432/");
  return cleanPgUrl(raw);
}

function apiBase(): string {
  return (
    process.env.COREMAP_API_BASE_URL?.trim() ||
    process.env.VITE_API_BASE_URL?.trim() ||
    "http://localhost:3001"
  ).replace(/\/$/, "");
}

function cliEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    COREMAP_API_BASE_URL: apiBase(),
    AUTH_BYPASS: "true",
  };
}

async function runNpmScript(script: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn("npm", ["run", script, "--", ...args], {
      cwd: repoRoot,
      env: cliEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("close", (code) => {
      resolvePromise({ ok: code === 0, output: output.trim() });
    });
    child.on("error", (error) => {
      resolvePromise({ ok: false, output: error.message });
    });
  });
}

async function clearLocalFeature(
  client: pg.Client,
  key: string,
  entity: "buildings" | "land_areas"
): Promise<void> {
  const base = entity === "buildings" ? "buildings_base" : "land_areas_base";
  await client.query(`DELETE FROM tile_source.${entity}_suppressed WHERE feature_key = $1`, [key]);
  await client.query(`DELETE FROM tile_source.${entity}_core WHERE feature_key = $1`, [key]);
  await client.query(`DELETE FROM tile_source.${entity}_archive WHERE feature_key = $1`, [key]);
  await client.query(`DELETE FROM tile_source.${base} WHERE external_id = $1`, [key]);
}

async function seedLocal(client: pg.Client): Promise<void> {
  await clearLocalFeature(client, BUILDING_KEY, "buildings");
  await clearLocalFeature(client, LAND_KEY, "land_areas");
  await client.query(
    `INSERT INTO tile_source.buildings_base (
      external_id, osm_feature_type, osm_id, source_snapshot_id,
      class_code, canonical_name, normalized_data, source_refs, geom
    ) VALUES (
      $1, 'way', 9100000001, 1, 'yes', 'VERIFY_BUILDING', '{}'::jsonb, '{}'::jsonb,
      ST_SetSRID(ST_GeomFromText($2), 4326)::geometry(MultiPolygon, 4326)
    )`,
    [BUILDING_KEY, GEOM_WKT]
  );
  await client.query(
    `INSERT INTO tile_source.land_areas_base (
      external_id, osm_feature_type, osm_id, source_snapshot_id,
      class_code, canonical_name, import_class, normalized_data, source_refs, geom
    ) VALUES (
      $1, 'way', 9200000001, 1, 'residential', 'VERIFY_LAND', 'pmtiles_only', '{}'::jsonb, '{}'::jsonb,
      ST_SetSRID(ST_GeomFromText($2), 4326)::geometry(MultiPolygon, 4326)
    )`,
    [LAND_KEY, GEOM_WKT]
  );
}

async function cleanupSupabase(client: pg.Client): Promise<void> {
  await client.query(`DELETE FROM core.core_building_render_suppressions WHERE feature_key = $1`, [
    BUILDING_KEY,
  ]);
  await client.query(
    `DELETE FROM core.core_buildings b
     WHERE system.pipeline_osm_identity_key(b.external_id) = $1
        OR (b.source_feature_type = 'way' AND b.source_feature_id = 9100000001)`,
    [BUILDING_KEY]
  );
  await client.query(`DELETE FROM core.core_land_area_render_suppressions WHERE feature_key = $1`, [
    LAND_KEY,
  ]);
  await client.query(
    `DELETE FROM core.core_land_areas la
     WHERE system.pipeline_osm_identity_key(la.external_id) = $1
        OR (la.source_feature_type = 'way' AND la.source_feature_id = 9200000001)`,
    [LAND_KEY]
  );
}

async function localState(client: pg.Client, entity: "buildings" | "land_areas", key: string) {
  const v = entity === "buildings" ? "buildings_v" : "land_areas_v";
  const base = entity === "buildings" ? "buildings_base" : "land_areas_base";
  const archive = entity === "buildings" ? "buildings_archive" : "land_areas_archive";
  const core = entity === "buildings" ? "buildings_core" : "land_areas_core";
  const suppressed = entity === "buildings" ? "buildings_suppressed" : "land_areas_suppressed";

  const resolved = await client.query<{ source: string | null }>(
    `SELECT source FROM tile_source.${v} WHERE feature_key = $1 LIMIT 1`,
    [key]
  );
  const flags = await client.query<{
    has_base: boolean;
    has_archive: boolean;
    has_core: boolean;
    suppressed: boolean;
  }>(
    `SELECT
      EXISTS(SELECT 1 FROM tile_source.${base} b WHERE b.external_id = $1) AS has_base,
      EXISTS(SELECT 1 FROM tile_source.${archive} a WHERE a.feature_key = $1) AS has_archive,
      EXISTS(SELECT 1 FROM tile_source.${core} c WHERE c.feature_key = $1 AND c.is_active AND c.deleted_at IS NULL) AS has_core,
      EXISTS(SELECT 1 FROM tile_source.${suppressed} s WHERE s.feature_key = $1) AS suppressed`,
    [key]
  );
  return { resolvedSource: resolved.rows[0]?.source ?? null, ...flags.rows[0] };
}

async function supabaseBuilding(client: pg.Client): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM core.core_buildings b
     WHERE b.is_active IS TRUE AND b.deleted_at IS NULL
       AND (
         system.pipeline_osm_identity_key(b.external_id) = $1
         OR (b.source_feature_type = 'way' AND b.source_feature_id = 9100000001)
       )
     LIMIT 1`,
    [BUILDING_KEY]
  );
  return (r.rowCount ?? 0) > 0;
}

async function supabaseLand(client: pg.Client): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM core.core_land_areas la
     WHERE la.is_active IS TRUE AND la.deleted_at IS NULL
       AND (
         system.pipeline_osm_identity_key(la.external_id) = $1
         OR (la.source_feature_type = 'way' AND la.source_feature_id = 9200000001)
       )
     LIMIT 1`,
    [LAND_KEY]
  );
  return (r.rowCount ?? 0) > 0;
}

async function main(): Promise<void> {
  const local = new pg.Client({ connectionString: localUrl() });
  const remote = new pg.Client({ connectionString: supabaseUrl() });
  await local.connect();
  await remote.connect();

  try {
    await cleanupSupabase(remote);
    await seedLocal(local);

    const status = await fetch(`${apiBase()}/local-basemap/status`);
    record("setup", "local-basemap/status route", status.status === 200, `HTTP ${status.status}`);

    const promoteB = await runNpmScript("tiles:promote-building", [BUILDING_KEY]);
    const bPromote = await localState(local, "buildings", BUILDING_KEY);
    record("building promote", "CLI exit 0", promoteB.ok, promoteB.ok ? "ok" : promoteB.output.slice(-200));
    record("building promote", "Supabase Core row", await supabaseBuilding(remote), "core.core_buildings");
    record(
      "building promote",
      "local buildings_v=core",
      bPromote.resolvedSource === "core",
      `source=${bPromote.resolvedSource ?? "ABSENT"}`
    );

    const demoteB = await runNpmScript("tiles:demote-building", [BUILDING_KEY]);
    const bDemote = await localState(local, "buildings", BUILDING_KEY);
    record("building demote", "CLI exit 0", demoteB.ok, demoteB.ok ? "ok" : demoteB.output.slice(-200));
    record("building demote", "Supabase Core removed", !(await supabaseBuilding(remote)), "absent expected");
    record(
      "building demote",
      "local archive+base, source=archive",
      bDemote.has_archive && bDemote.has_base && bDemote.resolvedSource === "archive",
      `archive=${bDemote.has_archive} base=${bDemote.has_base} source=${bDemote.resolvedSource ?? "ABSENT"}`
    );

    const deleteB = await runNpmScript("tiles:delete-building", ["--confirm-delete", BUILDING_KEY]);
    const bDelete = await localState(local, "buildings", BUILDING_KEY);
    record("building delete", "CLI exit 0", deleteB.ok, deleteB.ok ? "ok" : deleteB.output.slice(-200));
    record(
      "building delete",
      "local suppressed + absent from buildings_v",
      bDelete.suppressed && bDelete.resolvedSource === null,
      `suppressed=${bDelete.suppressed} base=${bDelete.has_base}`
    );

    await clearLocalFeature(local, LAND_KEY, "land_areas");
    await local.query(
      `INSERT INTO tile_source.land_areas_base (
        external_id, osm_feature_type, osm_id, source_snapshot_id,
        class_code, canonical_name, import_class, normalized_data, source_refs, geom
      ) VALUES (
        $1, 'way', 9200000001, 1, 'residential', 'VERIFY_LAND', 'pmtiles_only', '{}'::jsonb, '{}'::jsonb,
        ST_SetSRID(ST_GeomFromText($2), 4326)::geometry(MultiPolygon, 4326)
      )`,
      [LAND_KEY, GEOM_WKT]
    );

    const promoteL = await runNpmScript("tiles:promote-land", [LAND_KEY]);
    const lPromote = await localState(local, "land_areas", LAND_KEY);
    record("land promote", "CLI exit 0", promoteL.ok, promoteL.ok ? "ok" : promoteL.output.slice(-200));
    record("land promote", "Supabase Core row", await supabaseLand(remote), "core.core_land_areas");
    record(
      "land promote",
      "local land_areas_v=core",
      lPromote.resolvedSource === "core",
      `source=${lPromote.resolvedSource ?? "ABSENT"}`
    );

    const demoteL = await runNpmScript("tiles:demote-land", [LAND_KEY]);
    const lDemote = await localState(local, "land_areas", LAND_KEY);
    record("land demote", "CLI exit 0", demoteL.ok, demoteL.ok ? "ok" : demoteL.output.slice(-200));
    record("land demote", "Supabase Core removed", !(await supabaseLand(remote)), "absent expected");
    record(
      "land demote",
      "local archive+base",
      lDemote.has_archive && lDemote.has_base && lDemote.resolvedSource === "archive",
      `archive=${lDemote.has_archive} source=${lDemote.resolvedSource ?? "ABSENT"}`
    );

    const deleteL = await runNpmScript("tiles:delete-land", ["--confirm-delete", LAND_KEY]);
    const lDelete = await localState(local, "land_areas", LAND_KEY);
    record("land delete", "CLI exit 0", deleteL.ok, deleteL.ok ? "ok" : deleteL.output.slice(-200));
    record(
      "land delete",
      "local suppressed + absent from land_areas_v",
      lDelete.suppressed && lDelete.resolvedSource === null,
      `suppressed=${lDelete.suppressed}`
    );
  } finally {
    await cleanupSupabase(remote);
    await clearLocalFeature(local, BUILDING_KEY, "buildings");
    await clearLocalFeature(local, LAND_KEY, "land_areas");
    await local.end();
    await remote.end();
  }

  console.log("\n=== LIVE LIFECYCLE VERIFICATION ===\n");
  console.log("API base:", apiBase());
  console.log("");
  for (const r of rows) {
    console.log(`${r.result}\t[${r.step}] ${r.check} — ${r.detail}`);
  }
  const failed = rows.filter((r) => r.result === "FAIL").length;
  console.log(`\nTotal: ${rows.length} checks, ${failed} FAIL\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
