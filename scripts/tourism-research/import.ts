/**
 * Import normalized research JSON into tourism.research_candidates via Fastify admin API.
 *
 * Does NOT create production Foods/Guides/Advisories.
 *
 * Usage:
 *   npx tsx scripts/tourism-research/import.ts --township <public_id>
 *   npx tsx scripts/tourism-research/import.ts --all
 *   npx tsx scripts/tourism-research/import.ts --force --township <id>
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import dotenv from "dotenv";

import {
  parseNormalizedDocument,
  type NormalizedDocument,
} from "./normalized-schema";
import { researchPaths } from "./normalize";
import { loadState, saveState } from "./state";
import type { TownshipInput } from "./types";

const rootDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(rootDir, "../..");

dotenv.config({ path: resolve(repoRoot, ".env") });
dotenv.config({ path: resolve(repoRoot, "apps/api/.env") });

const BULK_MAX = 100;

export type ImportApiClient = {
  postImport(body: { candidates: Record<string, unknown>[] }): Promise<{
    imported: number;
    updated: number;
    skipped: number;
  }>;
};

export function mapDocumentToImportBatches(
  doc: NormalizedDocument,
): Array<{ candidates: Record<string, unknown>[] }> {
  const run = doc.research_run;
  const items = doc.candidates.map((c) => ({
    admin_area_public_id: run.township_public_id,
    candidate_key: c.candidate_key,
    entity_type: c.entity_type,
    name: c.entity_type === "local_guide" || c.entity_type === "advisory"
      ? c.payload.title?.trim() || c.name
      : c.name,
    evidence_confidence: c.evidence_confidence,
    research_provider: run.provider,
    research_run_id: run.research_interaction_id,
    researched_at: run.researched_at,
    research_status: "new",
    normalized_payload: {
      ...c.payload,
      candidate_key: c.candidate_key,
      title: c.payload.title ?? undefined,
      sources: c.payload.sources ?? [],
    },
  }));

  const batches: Array<{ candidates: Record<string, unknown>[] }> = [];
  for (let i = 0; i < items.length; i += BULK_MAX) {
    batches.push({ candidates: items.slice(i, i + BULK_MAX) });
  }
  return batches;
}

function apiBaseUrl(): string {
  return (
    process.env.COREMAP_API_BASE_URL?.trim() ||
    process.env.API_BASE_URL?.trim() ||
    "http://localhost:3001"
  );
}

async function loginAccessToken(): Promise<string | null> {
  const preset = process.env.COREMAP_ACCESS_TOKEN?.trim();
  if (preset) return preset;
  if (process.env.AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production") {
    return null;
  }
  const email = process.env.COREMAP_ADMIN_EMAIL?.trim();
  const password = process.env.COREMAP_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Set COREMAP_ACCESS_TOKEN or COREMAP_ADMIN_EMAIL + COREMAP_ADMIN_PASSWORD",
    );
  }
  const response = await fetch(`${apiBaseUrl()}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json().catch(() => null)) as {
    accessToken?: string;
    message?: string;
  } | null;
  if (!response.ok || !body?.accessToken) {
    throw new Error(
      `Admin login failed HTTP ${response.status}${body?.message ? `: ${body.message}` : ""}`,
    );
  }
  return body.accessToken;
}

export async function createHttpImportClient(): Promise<ImportApiClient> {
  const token = await loginAccessToken();
  return {
    async postImport(body) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (token) headers.authorization = `Bearer ${token}`;
      const response = await fetch(`${apiBaseUrl()}/admin/tourism/research/import`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const json = (await response.json().catch(() => null)) as {
        imported?: number;
        updated?: number;
        skipped?: number;
        message?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          `Import failed HTTP ${response.status}${json?.message ? `: ${json.message}` : ""}`,
        );
      }
      return {
        imported: json?.imported ?? 0,
        updated: json?.updated ?? 0,
        skipped: json?.skipped ?? 0,
      };
    },
  };
}

export async function importNormalizedDocument(
  doc: NormalizedDocument,
  client: ImportApiClient,
): Promise<{ imported: number; updated: number; skipped: number }> {
  const batches = mapDocumentToImportBatches(doc);
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  for (const batch of batches) {
    const result = await client.postImport(batch);
    imported += result.imported;
    updated += result.updated;
    skipped += result.skipped;
  }
  return { imported, updated, skipped };
}

function loadTownships(inputPath: string): TownshipInput[] {
  const parsed = JSON.parse(readFileSync(inputPath, "utf8")) as {
    townships?: TownshipInput[];
  };
  if (!Array.isArray(parsed.townships)) throw new Error("Invalid townships.json");
  return parsed.townships;
}

function parseArgs(argv: string[]) {
  let all = false;
  let force = false;
  let township: string | null = null;
  let input: string | null = null;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--all") all = true;
    else if (a === "--force") force = true;
    else if (a === "--township") township = argv[++i]?.trim() || null;
    else if (a === "--input") input = argv[++i]?.trim() || null;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return { all, force, township, input, help };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(`import normalized research into tourism.research_candidates

  --township <public_id>
  --all
  --force   re-import even if state.imported=true
`);
    return 0;
  }
  if (!opts.all && !opts.township) {
    throw new Error("Specify --township <id> or --all");
  }

  const paths = researchPaths();
  if (opts.input) {
    paths.inputPath = resolve(process.cwd(), opts.input);
  }
  const state = loadState(paths.statePath);
  const townships = loadTownships(paths.inputPath);
  const selected = opts.township
    ? townships.filter((t) => t.public_id === opts.township)
    : townships;
  if (selected.length === 0) throw new Error("No matching township");

  const client = await createHttpImportClient();
  let failed = 0;

  for (const township of selected) {
    const row = state.townships[township.public_id];
    if (!row?.normalized || !row.normalized_file) {
      console.log(`[import] skip ${township.name_en}: not normalized`);
      continue;
    }
    if (row.imported && !opts.force) {
      console.log(`[import] skip ${township.name_en}: already imported`);
      continue;
    }

    try {
      const doc = parseNormalizedDocument(
        JSON.parse(readFileSync(row.normalized_file, "utf8")),
      );
      const result = await importNormalizedDocument(doc, client);
      row.imported = true;
      row.imported_count = result.imported + result.updated + result.skipped;
      row.import_error = null;
      console.log(
        `[import] ${township.name_en}: created=${result.imported} updated=${result.updated} skipped=${result.skipped}`,
      );
    } catch (err) {
      failed += 1;
      row.import_error = err instanceof Error ? err.message : String(err);
      console.error(`[import] failed ${township.name_en}: ${row.import_error}`);
    }
    saveState(paths.statePath, state);
  }

  return failed > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
