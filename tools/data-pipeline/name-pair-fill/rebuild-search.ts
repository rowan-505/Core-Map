#!/usr/bin/env npx tsx
/**
 * Rebuild search documents after name-pair fills so primary_name_my / primary_name_en refresh.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/name-pair-fill/rebuild-search.ts --target production
 *   npx tsx tools/data-pipeline/name-pair-fill/rebuild-search.ts --target local --views places,settlements
 */

import process from "node:process";

import pg from "pg";

import {
  loadDatabaseEnv,
  resolvePipelineDatabaseUrl,
  type PipelineDbTarget,
} from "../train-app-import/lib/db.js";

const DEFAULT_VIEWS = [
  "places",
  "settlements",
  "admin_areas",
  "street_groups",
  "buildings",
  "transport_stops",
  "transport_terminals",
];

function parseArgs(argv: string[]) {
  let target: PipelineDbTarget = "local";
  let views = [...DEFAULT_VIEWS];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") {
      const v = argv[++i];
      if (v !== "local" && v !== "production") throw new Error(`Invalid --target ${v}`);
      target = v;
    } else if (arg === "--views") {
      views = (argv[++i] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return { target, views };
}

async function main(): Promise<void> {
  loadDatabaseEnv();
  const args = parseArgs(process.argv.slice(2));
  const url = resolvePipelineDatabaseUrl({ target: args.target, role: "write" });

  const pool = new pg.Pool({ connectionString: url, max: 1, statement_timeout: 1_800_000 });
  const client = await pool.connect();
  try {
    const exists = await client.query<{ ok: boolean }>(`
      SELECT to_regprocedure('search.rebuild_search_documents(text[])') IS NOT NULL AS ok
    `);
    if (!exists.rows[0]?.ok) {
      throw new Error("search.rebuild_search_documents(text[]) is not installed");
    }
    console.log(`Rebuilding search views: ${args.views.join(", ")}`);
    const result = await client.query(`SELECT search.rebuild_search_documents($1::text[]) AS result`, [
      args.views,
    ]);
    console.log(JSON.stringify(result.rows[0]?.result ?? result.rows, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
