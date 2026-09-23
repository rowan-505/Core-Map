/**
 * CLI: CoreMap township tourism Deep Research runner (dev/data only).
 *
 * Does NOT run inside Fastify. Does NOT write production DB.
 *
 * Usage (from repo root):
 *   npx tsx scripts/tourism-research/run.ts --township <public_id>
 *   npx tsx scripts/tourism-research/run.ts --resume
 *   npx tsx scripts/tourism-research/run.ts --force --township <public_id>
 *   npx tsx scripts/tourism-research/run.ts --retry-failed
 *   npx tsx scripts/tourism-research/run.ts --dry-run --township <public_id>
 *   npx tsx scripts/tourism-research/run.ts --all
 *
 * Env:
 *   GEMINI_API_KEY (required unless --dry-run)
 *   TOURISM_RESEARCH_AGENT (optional; default deep-research-max-preview-04-2026)
 *   TOURISM_RESEARCH_CONCURRENCY (optional; default 2)
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import dotenv from "dotenv";

import { createGeminiClient } from "./gemini";
import { loadPromptTemplate } from "./prompt";
import { mapPool, researchTownship } from "./research";
import { loadState, saveState } from "./state";
import {
  DEFAULT_DEEP_RESEARCH_AGENT,
  type ResearchConfig,
  type ResearchPaths,
  type TownshipInput,
} from "./types";
import { DEFAULT_NORMALIZE_MODEL } from "./normalized-schema";

const rootDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(rootDir, "../..");

dotenv.config({ path: resolve(repoRoot, ".env") });
dotenv.config({ path: resolve(repoRoot, "apps/api/.env") });

function paths(inputOverride?: string | null): ResearchPaths {
  return {
    rootDir,
    inputPath: inputOverride
      ? resolve(process.cwd(), inputOverride)
      : resolve(rootDir, "input/townships.json"),
    promptPath: resolve(rootDir, "prompts/research.md"),
    normalizePromptPath: resolve(rootDir, "prompts/normalize.md"),
    statePath: resolve(rootDir, "state.json"),
    rawDir: resolve(rootDir, "output/raw"),
    normalizedDir: resolve(rootDir, "output/normalized"),
  };
}

function parseArgs(argv: string[]): {
  all: boolean;
  resume: boolean;
  force: boolean;
  retryFailed: boolean;
  dryRun: boolean;
  township: string | null;
  concurrency: number | null;
  input: string | null;
  confirmBatch: boolean;
  help: boolean;
} {
  let all = false;
  let resume = false;
  let force = false;
  let retryFailed = false;
  let dryRun = false;
  let township: string | null = null;
  let concurrency: number | null = null;
  let input: string | null = null;
  let confirmBatch = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--all") all = true;
    else if (arg === "--resume") resume = true;
    else if (arg === "--force") force = true;
    else if (arg === "--retry-failed") retryFailed = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--confirm-batch") confirmBatch = true;
    else if (arg === "--township") {
      township = argv[++i]?.trim() || null;
      if (!township) throw new Error("--township requires a public_id");
    } else if (arg === "--input") {
      input = argv[++i]?.trim() || null;
      if (!input) throw new Error("--input requires a path");
    } else if (arg === "--concurrency") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) throw new Error("--concurrency must be >= 1");
      concurrency = Math.floor(n);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    all,
    resume,
    force,
    retryFailed,
    dryRun,
    township,
    concurrency,
    input,
    confirmBatch,
    help,
  };
}

function printHelp(): void {
  console.log(`CoreMap tourism Deep Research runner

  --township <public_id>   Run one township
  --all                    Run every township in the input file
  --input <path>           Township JSON (default input/townships.json)
  --resume                 Continue pending/running (skip completed)
  --force                  Rerun even if completed
  --retry-failed           Include previously failed townships
  --dry-run                Render prompt only; no Gemini calls
  --concurrency <n>        Parallel jobs (default 2)
  --confirm-batch          Required for paid runs of >5 townships
  --help                   Show this help

Environment:
  GEMINI_API_KEY
  TOURISM_RESEARCH_AGENT   (default ${DEFAULT_DEEP_RESEARCH_AGENT})
  TOURISM_RESEARCH_CONCURRENCY
`);
}

function loadTownships(inputPath: string): TownshipInput[] {
  const parsed = JSON.parse(readFileSync(inputPath, "utf8")) as {
    townships?: TownshipInput[];
  };
  if (!Array.isArray(parsed.townships) || parsed.townships.length === 0) {
    throw new Error(`No townships in ${inputPath}`);
  }
  return parsed.townships;
}

function buildConfig(opts: ReturnType<typeof parseArgs>): ResearchConfig {
  const envConcurrency = Number(process.env.TOURISM_RESEARCH_CONCURRENCY || "");
  const concurrency =
    opts.concurrency ??
    (Number.isFinite(envConcurrency) && envConcurrency >= 1
      ? Math.floor(envConcurrency)
      : 2);

  return {
    apiKey: process.env.GEMINI_API_KEY?.trim() || "",
    agent:
      process.env.TOURISM_RESEARCH_AGENT?.trim() || DEFAULT_DEEP_RESEARCH_AGENT,
    normalizeModel:
      process.env.TOURISM_NORMALIZE_MODEL?.trim() || DEFAULT_NORMALIZE_MODEL,
    concurrency,
    pollIntervalMs: Number(process.env.TOURISM_RESEARCH_POLL_MS || 15_000) || 15_000,
    maxPollAttempts: Number(process.env.TOURISM_RESEARCH_MAX_POLLS || 240) || 240,
    maxCreateRetries: Number(process.env.TOURISM_RESEARCH_CREATE_RETRIES || 3) || 3,
    force: opts.force,
    retryFailed: opts.retryFailed,
    dryRun: opts.dryRun,
    townshipFilter: opts.township,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }

  if (!opts.all && !opts.resume && !opts.township) {
    printHelp();
    throw new Error("Specify --township <id>, --all, or --resume");
  }

  const p = paths(opts.input);
  const config = buildConfig(opts);
  if (!config.dryRun && !config.apiKey) {
    throw new Error("GEMINI_API_KEY is required (or use --dry-run)");
  }

  const townships = loadTownships(p.inputPath);
  const selected = config.townshipFilter
    ? townships.filter((t) => t.public_id === config.townshipFilter)
    : townships;

  if (selected.length === 0) {
    throw new Error(
      config.townshipFilter
        ? `Township not found in input: ${config.townshipFilter}`
        : "No townships selected",
    );
  }

  if (!config.dryRun && selected.length > 5 && !opts.confirmBatch) {
    throw new Error(
      `Refusing paid run of ${selected.length} townships without --confirm-batch (pilot max without confirm is 5)`,
    );
  }

  const state = loadState(p.statePath);
  saveState(p.statePath, state);

  const promptTemplate = loadPromptTemplate(p.promptPath);
  const client = config.dryRun
    ? {
        createDeepResearch: async () => {
          throw new Error("dry-run");
        },
        getInteraction: async () => {
          throw new Error("dry-run");
        },
        generateJson: async () => {
          throw new Error("dry-run");
        },
      }
    : createGeminiClient(config.apiKey);

  console.log(
    `[tourism-research] agent=${config.agent} concurrency=${config.concurrency} townships=${selected.length}`,
  );

  const results = await mapPool(selected, config.concurrency, (township) =>
    researchTownship(township, {
      client,
      paths: p,
      config,
      promptTemplate,
      state,
    }),
  );

  const summary = {
    completed: results.filter((r) => r === "completed").length,
    failed: results.filter((r) => r === "failed").length,
    skipped: results.filter((r) => r === "skipped").length,
  };
  console.log(`[tourism-research] done`, summary);
  return summary.failed > 0 ? 1 : 0;
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
