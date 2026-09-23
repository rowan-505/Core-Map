#!/usr/bin/env npx tsx
/**
 * Nationwide bilingual name-pair fill.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/name-pair-fill/run.ts --target local
 *   npx tsx tools/data-pipeline/name-pair-fill/run.ts --target production --dry-run
 *   npx tsx tools/data-pipeline/name-pair-fill/run.ts --target production --apply
 *   npx tsx tools/data-pipeline/name-pair-fill/run.ts --target production --apply --entities places,settlements
 */

import process from "node:process";

import pg from "pg";

import {
  emptySummary,
  fillAdminAreas,
  fillBuildings,
  fillPlaces,
  fillSettlements,
  fillStreets,
  fillTransportStops,
  fillTransportTerminals,
} from "./apply.js";
import {
  DEFAULT_PRODUCTION_PROJECT_REF,
  extractProjectRef,
  printResolvedDbTarget,
  resolveDbTarget,
} from "../lib/database-target-safety.js";
import { loadDatabaseEnv, type PipelineDbTarget } from "../train-app-import/lib/db.js";

type EntityKey =
  | "places"
  | "settlements"
  | "admin_areas"
  | "streets"
  | "buildings"
  | "transport_stops"
  | "transport_terminals";

const ALL_ENTITIES: EntityKey[] = [
  "settlements",
  "admin_areas",
  "places",
  "streets",
  "buildings",
  "transport_stops",
  "transport_terminals",
];

/**
 * apps/api/.env often only has DATABASE_URL for Supabase.
 * Pipeline safety refuses bare DATABASE_URL for production writes unless
 * SUPABASE_WRITE_DATABASE_URL (or legacy SUPABASE_DATABASE_URL) is set.
 * Mirror the tiles sync pattern: promote DATABASE_URL when it is clearly
 * the CoreMap production project.
 */
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
  let entities = [...ALL_ENTITIES];
  let limit: number | undefined;

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
    } else if (arg === "--entities") {
      const raw = argv[++i] ?? "";
      entities = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) as EntityKey[];
    } else if (arg === "--limit") {
      limit = Number(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return { target, dryRun: apply ? false : dryRun, entities, limit };
}

function printHelp(): void {
  console.log(`name-pair-fill

  --target local|production   Database target (required via safety resolver)
  --dry-run                   Count and classify only (default)
  --apply                     Write auto fills + enqueue reviews
  --entities a,b,c            Subset of: ${ALL_ENTITIES.join(",")}
  --limit N                   Cap rows per entity family

  Production writes use SUPABASE_WRITE_DATABASE_URL, or legacy SUPABASE_DATABASE_URL.
  If only DATABASE_URL is set and it matches the CoreMap Supabase project, it is used.
`);
}

async function main(): Promise<void> {
  loadDatabaseEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.target === "production") {
    ensureProductionWriteUrlFromDatabaseUrl();
  }

  const resolved = resolveDbTarget({
    target: args.target,
    role: args.target === "local" ? "local" : "write",
  });
  printResolvedDbTarget(resolved);
  const url = resolved.url;

  const runId = `name-pair-fill-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const summary = emptySummary(runId, args.dryRun);

  console.log(
    JSON.stringify(
      {
        runId,
        target: args.target,
        dryRun: args.dryRun,
        entities: args.entities,
        limit: args.limit ?? null,
      },
      null,
      2,
    ),
  );

  // Pooler URLs often include sslmode=require; newer pg treats that as verify-full
  // and fails on Supabase's intermediate cert. Normalize to explicit soft SSL.
  let connectionString = url;
  if (url.includes("supabase")) {
    const u = new URL(url.replace(/^postgres(ql)?:\/\//, "postgresql://"));
    u.searchParams.delete("sslmode");
    u.searchParams.set("sslmode", "no-verify");
    connectionString = u.toString();
  }

  const pool = new pg.Pool({
    connectionString,
    max: 1,
    // Keep idle connections alive; pooler drops long-held sessions.
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 60_000,
    statement_timeout: 120_000,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });

  // Prefer a fresh client per family so a mid-run ETIMEDOUT can recover.
  async function withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  try {
    if (!args.dryRun) {
      await withClient(async (client) => {
        await client.query(
          `INSERT INTO ops.name_pair_fill_runs (run_id, dry_run, summary)
           VALUES ($1, false, '{}'::jsonb)
           ON CONFLICT (run_id) DO NOTHING`,
          [runId],
        );
      });
    }

    for (const entity of args.entities) {
      console.log(`Processing ${entity}...`);
      const started = Date.now();
      // Autocommit each write so a timeout mid-family keeps earlier rows.
      await withClient(async (client) => {
        switch (entity) {
          case "places":
            await fillPlaces(client, runId, args.dryRun, summary, args.limit);
            break;
          case "settlements":
            await fillSettlements(client, runId, args.dryRun, summary, args.limit);
            break;
          case "admin_areas":
            await fillAdminAreas(client, runId, args.dryRun, summary, args.limit);
            break;
          case "streets":
            await fillStreets(client, runId, args.dryRun, summary, args.limit);
            break;
          case "buildings":
            await fillBuildings(client, runId, args.dryRun, summary, args.limit);
            break;
          case "transport_stops":
            await fillTransportStops(client, runId, args.dryRun, summary, args.limit);
            break;
          case "transport_terminals":
            await fillTransportTerminals(client, runId, args.dryRun, summary, args.limit);
            break;
          default:
            throw new Error(`Unknown entity ${entity}`);
        }
      });
      console.log(
        `  done ${entity} in ${Math.round((Date.now() - started) / 1000)}s:`,
        summary.byEntity[entityKeyToType(entity)] ?? summary.byEntity,
      );
    }

    if (!args.dryRun) {
      await withClient(async (client) => {
        await client.query(
          `UPDATE ops.name_pair_fill_runs
           SET finished_at = now(), summary = $2::jsonb
           WHERE run_id = $1`,
          [runId, JSON.stringify(summary)],
        );
      });
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
}

function entityKeyToType(key: EntityKey): string {
  const map: Record<EntityKey, string> = {
    places: "place",
    settlements: "settlement",
    admin_areas: "admin_area",
    streets: "street",
    buildings: "building",
    transport_stops: "transport_stop",
    transport_terminals: "transport_terminal",
  };
  return map[key];
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
