#!/usr/bin/env npx tsx
/**
 * Re-queue AI/auto transliteration name pairs into ops.name_pair_reviews
 * so the dashboard Name pairs page can filter, edit, approve, or reject them.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/name-pair-fill/requeue-auto-applied.ts --target production --dry-run
 *   npx tsx tools/data-pipeline/name-pair-fill/requeue-auto-applied.ts --target production --apply
 */

import process from "node:process";

import pg from "pg";

import {
  DEFAULT_PRODUCTION_PROJECT_REF,
  extractProjectRef,
  printResolvedDbTarget,
  resolveDbTarget,
} from "../lib/database-target-safety.js";
import { loadDatabaseEnv, type PipelineDbTarget } from "../train-app-import/lib/db.js";
import { romanizeMyanmarToEnglish } from "./romanize.js";

const REASON = "auto_applied_needs_review";
const DIRECTION = "review_auto_applied";
const RUN_ID_PREFIX = "requeue-auto-applied";

function ensureProductionWriteUrlFromDatabaseUrl(): void {
  if (process.env.SUPABASE_WRITE_DATABASE_URL?.trim()) return;
  if (process.env.SUPABASE_DATABASE_URL?.trim()) return;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return;
  if (databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1")) return;

  const expected =
    process.env.DB_TARGET_PRODUCTION_PROJECT_REF?.trim() || DEFAULT_PRODUCTION_PROJECT_REF;
  const ref = extractProjectRef(databaseUrl);
  const looksSupabase =
    databaseUrl.includes("supabase") || databaseUrl.includes("pooler.supabase");
  if (!looksSupabase) return;
  if (ref !== expected && !databaseUrl.includes(expected)) {
    throw new Error(
      `DATABASE_URL does not match production project_ref=${expected}; ` +
        "set SUPABASE_WRITE_DATABASE_URL explicitly",
    );
  }

  process.env.SUPABASE_WRITE_DATABASE_URL = databaseUrl;
  console.log(
    `[env] SUPABASE_WRITE_DATABASE_URL set from DATABASE_URL (project_ref=${expected})`,
  );
}

function parseArgs(argv: string[]) {
  let target: PipelineDbTarget = "local";
  let dryRun = true;
  let apply = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") {
      const v = argv[++i];
      if (v !== "local" && v !== "production") {
        throw new Error(`Invalid --target ${v}`);
      }
      target = v;
    } else if (arg === "--dry-run") {
      dryRun = true;
      apply = false;
    } else if (arg === "--apply") {
      apply = true;
      dryRun = false;
    }
  }

  return { target, dryRun: apply ? false : dryRun, apply };
}

async function countCandidates(client: pg.PoolClient) {
  const places = await client.query<{ n: string }>(`
    SELECT count(*)::text AS n
    FROM (
      SELECT place_id
      FROM core.core_place_names
      WHERE name_type = 'transliteration'
      GROUP BY place_id
    ) t
  `);
  const admin = await client.query<{ n: string }>(`
    SELECT count(*)::text AS n
    FROM (
      SELECT admin_area_id
      FROM core.core_admin_area_names
      WHERE name_type = 'transliteration'
      GROUP BY admin_area_id
    ) t
  `);
  const streets = await client.query<{ n: string }>(`
    SELECT count(*)::text AS n
    FROM (
      SELECT street_id
      FROM core.core_street_names
      WHERE name_type = 'transliteration'
      GROUP BY street_id
    ) t
  `);
  const buildings = await client.query<{ n: string }>(`
    SELECT count(*)::text AS n
    FROM (
      SELECT building_id
      FROM core.core_building_names
      WHERE name_type = 'transliteration'
      GROUP BY building_id
    ) t
  `);
  const already = await client.query<{ n: string }>(`
    SELECT count(*)::text AS n
    FROM ops.name_pair_reviews
    WHERE reason = $1 AND status = 'pending' AND direction = $2
  `, [REASON, DIRECTION]);

  return {
    places: Number(places.rows[0]?.n ?? 0),
    admin_areas: Number(admin.rows[0]?.n ?? 0),
    streets: Number(streets.rows[0]?.n ?? 0),
    buildings: Number(buildings.rows[0]?.n ?? 0),
    already_pending: Number(already.rows[0]?.n ?? 0),
  };
}

async function enqueueNameTable(
  client: pg.PoolClient,
  args: {
    entityType: string;
    table: string;
    fk: string;
    entityTable: string;
    entityIdCol: string;
    publicIdExpr: string;
    sourceExpr: string;
    deletedClause: string;
    dryRun: boolean;
    runId: string;
  },
): Promise<number> {
  const sql = `
    WITH tr AS (
      SELECT
        n.${args.fk} AS entity_id,
        max(n.name) FILTER (WHERE n.language_code IN ('my', 'mm')) AS mm_tr,
        max(n.name) FILTER (WHERE n.language_code = 'en') AS en_tr
      FROM ${args.table} n
      WHERE n.name_type = 'transliteration'
      GROUP BY n.${args.fk}
    ),
    src AS (
      SELECT
        e.${args.entityIdCol} AS entity_id,
        ${args.publicIdExpr} AS entity_public_id,
        ${args.sourceExpr} AS source_name,
        tr.mm_tr,
        tr.en_tr
      FROM ${args.entityTable} e
      JOIN tr ON tr.entity_id = e.${args.entityIdCol}
      WHERE ${args.deletedClause}
    )
    INSERT INTO ops.name_pair_reviews (
      entity_type, entity_id, entity_public_id, direction,
      source_name, proposed_mm, proposed_en, confidence, reason, status, fill_run_id
    )
    SELECT
      $1,
      s.entity_id,
      s.entity_public_id,
      $2,
      left(btrim(coalesce(s.source_name, s.mm_tr, s.en_tr, 'unknown')), 500),
      nullif(btrim(s.mm_tr), ''),
      nullif(btrim(s.en_tr), ''),
      40,
      $3,
      'pending',
      $4
    FROM src s
    WHERE (nullif(btrim(s.mm_tr), '') IS NOT NULL OR nullif(btrim(s.en_tr), '') IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM ops.name_pair_reviews r
        WHERE r.entity_type = $1
          AND r.entity_id = s.entity_id
          AND r.direction = $2
          AND r.status = 'pending'
      )
  `;

  if (args.dryRun) {
    const count = await client.query<{ n: string }>(`
      WITH tr AS (
        SELECT
          n.${args.fk} AS entity_id,
          max(n.name) FILTER (WHERE n.language_code IN ('my', 'mm')) AS mm_tr,
          max(n.name) FILTER (WHERE n.language_code = 'en') AS en_tr
        FROM ${args.table} n
        WHERE n.name_type = 'transliteration'
        GROUP BY n.${args.fk}
      ),
      src AS (
        SELECT e.${args.entityIdCol} AS entity_id, tr.mm_tr, tr.en_tr
        FROM ${args.entityTable} e
        JOIN tr ON tr.entity_id = e.${args.entityIdCol}
        WHERE ${args.deletedClause}
      )
      SELECT count(*)::text AS n
      FROM src s
      WHERE (nullif(btrim(s.mm_tr), '') IS NOT NULL OR nullif(btrim(s.en_tr), '') IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM ops.name_pair_reviews r
          WHERE r.entity_type = $1
            AND r.entity_id = s.entity_id
            AND r.direction = $2
            AND r.status = 'pending'
        )
    `, [args.entityType, DIRECTION]);
    return Number(count.rows[0]?.n ?? 0);
  }

  const result = await client.query(sql, [args.entityType, DIRECTION, REASON, args.runId]);
  return result.rowCount ?? 0;
}

async function enqueueSettlementsMatchingRomanizer(
  client: pg.PoolClient,
  dryRun: boolean,
  runId: string,
): Promise<{ scanned: number; matched: number; inserted: number }> {
  const rows = await client.query<{
    id: string;
    public_id: string | null;
    name_mm: string;
    name_en: string;
  }>(`
    SELECT id::text, public_id::text, btrim(name_mm) AS name_mm, btrim(name_en) AS name_en
    FROM core.core_settlements
    WHERE nullif(btrim(name_mm), '') IS NOT NULL
      AND nullif(btrim(name_en), '') IS NOT NULL
      AND btrim(name_mm) IS DISTINCT FROM btrim(name_en)
      AND name_mm ~ '[\\u1000-\\u109F]'
      AND name_en ~ '[A-Za-z]'
      AND name_en !~ '[\\u1000-\\u109F]'
  `);

  let matched = 0;
  let inserted = 0;

  for (const row of rows.rows) {
    const romanized = romanizeMyanmarToEnglish(row.name_mm);
    if (!romanized) continue;
    const got = row.name_en.trim().toLowerCase();
    const want = romanized.text.trim().toLowerCase();
    if (got !== want) continue;
    matched += 1;

    if (dryRun) continue;

    const result = await client.query(
      `
      INSERT INTO ops.name_pair_reviews (
        entity_type, entity_id, entity_public_id, direction,
        source_name, proposed_mm, proposed_en, confidence, reason, status, fill_run_id
      )
      SELECT
        'settlement', $1::bigint, $2::uuid, $3,
        left($4, 500), $5, $6, 40, $7, 'pending', $8
      WHERE NOT EXISTS (
        SELECT 1 FROM ops.name_pair_reviews r
        WHERE r.entity_type = 'settlement'
          AND r.entity_id = $1::bigint
          AND r.direction = $3
          AND r.status = 'pending'
      )
      `,
      [
        row.id,
        row.public_id,
        DIRECTION,
        row.name_mm,
        row.name_mm,
        row.name_en,
        REASON,
        runId,
      ],
    );
    inserted += result.rowCount ?? 0;
  }

  return { scanned: rows.rows.length, matched, inserted };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadDatabaseEnv();
  if (args.target === "production") {
    ensureProductionWriteUrlFromDatabaseUrl();
  }

  const resolved = resolveDbTarget({
    target: args.target,
    role: args.target === "local" ? "local" : "write",
  });
  printResolvedDbTarget(resolved);

  let connectionString = resolved.url;
  if (resolved.url.includes("supabase")) {
    const u = new URL(resolved.url.replace(/^postgres(ql)?:\/\//, "postgresql://"));
    u.searchParams.delete("sslmode");
    u.searchParams.set("sslmode", "no-verify");
    connectionString = u.toString();
  }

  const runId = `${RUN_ID_PREFIX}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const client = new pg.Client({
    connectionString,
    ssl: resolved.url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    const candidates = await countCandidates(client);
    console.log("[counts] AI transliteration entities:", candidates);

    const placeWould = await enqueueNameTable(client, {
      entityType: "place",
      table: "core.core_place_names",
      fk: "place_id",
      entityTable: "core.core_places",
      entityIdCol: "id",
      publicIdExpr: "e.public_id",
      sourceExpr: `coalesce(
        (SELECT n.name FROM core.core_place_names n
         WHERE n.place_id = e.id AND n.is_primary = true
         ORDER BY n.id LIMIT 1),
        e.primary_name,
        e.display_name,
        tr.mm_tr,
        tr.en_tr
      )`,
      deletedClause: "e.deleted_at IS NULL",
      dryRun: true,
      runId,
    });
    const adminWould = await enqueueNameTable(client, {
      entityType: "admin_area",
      table: "core.core_admin_area_names",
      fk: "admin_area_id",
      entityTable: "core.core_admin_areas",
      entityIdCol: "id",
      publicIdExpr: "e.public_id",
      sourceExpr: `coalesce(
        (SELECT n.name FROM core.core_admin_area_names n
         WHERE n.admin_area_id = e.id AND n.is_primary = true
         ORDER BY n.id LIMIT 1),
        e.canonical_name,
        tr.mm_tr,
        tr.en_tr
      )`,
      deletedClause: "e.deleted_at IS NULL AND e.is_active = true",
      dryRun: true,
      runId,
    });
    const streetWould = await enqueueNameTable(client, {
      entityType: "street",
      table: "core.core_street_names",
      fk: "street_id",
      entityTable: "core.core_streets",
      entityIdCol: "id",
      publicIdExpr: "e.public_id",
      sourceExpr: "coalesce(e.canonical_name, tr.mm_tr, tr.en_tr)",
      deletedClause: "e.deleted_at IS NULL",
      dryRun: true,
      runId,
    });
    const buildingWould = await enqueueNameTable(client, {
      entityType: "building",
      table: "core.core_building_names",
      fk: "building_id",
      entityTable: "core.core_buildings",
      entityIdCol: "id",
      publicIdExpr: "e.public_id",
      sourceExpr: "coalesce(e.name, tr.mm_tr, tr.en_tr)",
      deletedClause: "e.deleted_at IS NULL",
      dryRun: true,
      runId,
    });

    console.log("[dry-run would enqueue]", {
      place: placeWould,
      admin_area: adminWould,
      street: streetWould,
      building: buildingWould,
    });

    if (!args.apply) {
      const settlementPreview = await enqueueSettlementsMatchingRomanizer(client, true, runId);
      console.log("[dry-run settlement romanizer match]", settlementPreview);
      console.log("Dry run only. Re-run with --apply to insert pending reviews.");
      return;
    }

    await client.query(
      `
      INSERT INTO ops.name_pair_fill_runs (run_id, dry_run, started_at, summary)
      VALUES ($1, false, now(), '{}'::jsonb)
      ON CONFLICT (run_id) DO NOTHING
      `,
      [runId],
    );

    const inserted = {
      place: await enqueueNameTable(client, {
        entityType: "place",
        table: "core.core_place_names",
        fk: "place_id",
        entityTable: "core.core_places",
        entityIdCol: "id",
        publicIdExpr: "e.public_id",
        sourceExpr: `coalesce(
          (SELECT n.name FROM core.core_place_names n
           WHERE n.place_id = e.id AND n.is_primary = true
           ORDER BY n.id LIMIT 1),
          e.primary_name,
          e.display_name,
          tr.mm_tr,
          tr.en_tr
        )`,
        deletedClause: "e.deleted_at IS NULL",
        dryRun: false,
        runId,
      }),
      admin_area: await enqueueNameTable(client, {
        entityType: "admin_area",
        table: "core.core_admin_area_names",
        fk: "admin_area_id",
        entityTable: "core.core_admin_areas",
        entityIdCol: "id",
        publicIdExpr: "e.public_id",
        sourceExpr: `coalesce(
          (SELECT n.name FROM core.core_admin_area_names n
           WHERE n.admin_area_id = e.id AND n.is_primary = true
           ORDER BY n.id LIMIT 1),
          e.canonical_name,
          tr.mm_tr,
          tr.en_tr
        )`,
        deletedClause: "e.deleted_at IS NULL AND e.is_active = true",
        dryRun: false,
        runId,
      }),
      street: await enqueueNameTable(client, {
        entityType: "street",
        table: "core.core_street_names",
        fk: "street_id",
        entityTable: "core.core_streets",
        entityIdCol: "id",
        publicIdExpr: "e.public_id",
        sourceExpr: "coalesce(e.canonical_name, tr.mm_tr, tr.en_tr)",
        deletedClause: "e.deleted_at IS NULL",
        dryRun: false,
        runId,
      }),
      building: await enqueueNameTable(client, {
        entityType: "building",
        table: "core.core_building_names",
        fk: "building_id",
        entityTable: "core.core_buildings",
        entityIdCol: "id",
        publicIdExpr: "e.public_id",
        sourceExpr: "coalesce(e.name, tr.mm_tr, tr.en_tr)",
        deletedClause: "e.deleted_at IS NULL",
        dryRun: false,
        runId,
      }),
    };

    const settlement = await enqueueSettlementsMatchingRomanizer(client, false, runId);

    await client.query(
      `
      UPDATE ops.name_pair_fill_runs
      SET finished_at = now(),
          summary = $2::jsonb
      WHERE run_id = $1
      `,
      [
        runId,
        JSON.stringify({
          reason: REASON,
          direction: DIRECTION,
          inserted,
          settlement,
          candidates,
        }),
      ],
    );

    console.log("[applied]", { runId, inserted, settlement });
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
