/**
 * Normalize completed Deep Research raw reports into structured JSON.
 *
 * Usage:
 *   npx tsx scripts/tourism-research/normalize.ts --township <public_id>
 *   npx tsx scripts/tourism-research/normalize.ts --all
 *   npx tsx scripts/tourism-research/normalize.ts --force --township <id>
 *   npx tsx scripts/tourism-research/normalize.ts --from-json <path>  (offline validate/write)
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import dotenv from "dotenv";

import { ensureUniqueCandidateKeys, buildCandidateKey } from "./candidate-key";
import { createGeminiClient, withRetries } from "./gemini";
import {
  NORMALIZE_PROMPT_VERSION,
  DEFAULT_NORMALIZE_MODEL,
  parseNormalizedDocument,
  type NormalizedDocument,
} from "./normalized-schema";
import { loadState, saveState } from "./state";
import type { GeminiClient, ResearchPaths, TownshipInput, TownshipState } from "./types";

const rootDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(rootDir, "../..");

dotenv.config({ path: resolve(repoRoot, ".env") });
dotenv.config({ path: resolve(repoRoot, "apps/api/.env") });

export function researchPaths(): ResearchPaths {
  return {
    rootDir,
    inputPath: resolve(rootDir, "input/townships.json"),
    promptPath: resolve(rootDir, "prompts/research.md"),
    normalizePromptPath: resolve(rootDir, "prompts/normalize.md"),
    statePath: resolve(rootDir, "state.json"),
    rawDir: resolve(rootDir, "output/raw"),
    normalizedDir: resolve(rootDir, "output/normalized"),
  };
}

export function parseRawMetadata(rawMarkdown: string): {
  interactionId: string | null;
  researchedAt: string | null;
  promptVersion: string | null;
  publicId: string | null;
  nameEn: string | null;
  nameMm: string | null;
  regionEn: string | null;
} {
  const pick = (key: string) => {
    const m = rawMarkdown.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m?.[1]?.trim() || null;
  };
  return {
    interactionId: pick("gemini_interaction_id"),
    researchedAt: pick("researched_at"),
    promptVersion: pick("prompt_version"),
    publicId: pick("township_public_id"),
    nameEn: pick("name_en"),
    nameMm: pick("name_mm"),
    regionEn: pick("region_en"),
  };
}

export function renderNormalizePrompt(
  template: string,
  vars: Record<string, string>,
): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  if (out.includes("{{")) {
    throw new Error("Unresolved normalize prompt placeholders");
  }
  return out;
}

export function postProcessNormalizedDoc(
  doc: NormalizedDocument,
  expected: {
    public_id: string;
    name_en: string;
    name_mm: string;
    region_en: string;
    interaction_id: string;
    researched_at: string;
    prompt_version: string;
  },
): NormalizedDocument {
  const withKeys = {
    ...doc,
    schema_version: "tourism-research-v1" as const,
    research_run: {
      ...doc.research_run,
      township_public_id: expected.public_id,
      township_name_en: expected.name_en,
      township_name_mm: expected.name_mm,
      region_en: expected.region_en,
      provider: "gemini" as const,
      research_interaction_id: expected.interaction_id,
      researched_at: expected.researched_at,
      prompt_version: expected.prompt_version,
    },
    candidates: ensureUniqueCandidateKeys(
      doc.candidates.map((c) => ({
        ...c,
        candidate_key:
          c.candidate_key?.trim() || buildCandidateKey(c.entity_type, c.name),
        payload: {
          ...c.payload,
          manual_boost_reference: c.payload.manual_boost_reference ?? 0,
        },
      })),
    ),
  };
  return parseNormalizedDocument(withKeys);
}

export function normalizedOutputPath(normalizedDir: string, townshipKey: string): string {
  return resolve(normalizedDir, `${townshipKey}.json`);
}

export async function normalizeTownship(opts: {
  township: TownshipInput;
  row: TownshipState;
  paths: ResearchPaths;
  client: GeminiClient;
  model: string;
  force: boolean;
  normalizeFn?: (prompt: string) => Promise<unknown>;
}): Promise<"skipped" | "completed" | "failed"> {
  const { township, row, paths, client, model, force } = opts;
  if (row.status !== "completed" || !row.raw_output_path) {
    console.log(`[normalize] skip ${township.name_en}: raw research not completed`);
    return "skipped";
  }
  if (row.normalized && row.normalized_file && !force) {
    console.log(`[normalize] skip ${township.name_en}: already normalized`);
    return "skipped";
  }

  try {
    const raw = readFileSync(row.raw_output_path, "utf8");
    const meta = parseRawMetadata(raw);
    const interactionId = meta.interactionId || row.interaction_id;
    if (!interactionId) throw new Error("Missing gemini_interaction_id in raw report");
    const researchedAt = meta.researchedAt || row.completed_at || new Date().toISOString();
    const promptVersion = meta.promptVersion || row.prompt_version || "unknown";

    const template = readFileSync(paths.normalizePromptPath, "utf8");
    const prompt = renderNormalizePrompt(template, {
      public_id: township.public_id,
      name_en: township.name_en,
      name_mm: township.name_mm,
      region_en: township.region_en,
      research_interaction_id: interactionId,
      researched_at: researchedAt,
      prompt_version: promptVersion,
      raw_report: raw,
    });

    const rawJson = opts.normalizeFn
      ? await opts.normalizeFn(prompt)
      : await withRetries(
          () => client.generateJson({ model, prompt }),
          { maxAttempts: 3, label: `normalize:${township.public_id}` },
        );

    const doc = postProcessNormalizedDoc(rawJson as NormalizedDocument, {
      public_id: township.public_id,
      name_en: township.name_en,
      name_mm: township.name_mm,
      region_en: township.region_en,
      interaction_id: interactionId,
      researched_at: researchedAt,
      prompt_version: promptVersion,
    });

    mkdirSync(paths.normalizedDir, { recursive: true });
    const outPath = normalizedOutputPath(paths.normalizedDir, township.public_id);
    writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

    row.normalized = true;
    row.normalized_file = outPath;
    row.normalization_error = null;
    // Re-import needed after re-normalize
    if (force) {
      row.imported = false;
      row.imported_count = 0;
      row.import_error = null;
    }
    return "completed";
  } catch (err) {
    row.normalized = false;
    row.normalization_error = err instanceof Error ? err.message : String(err);
    console.error(`[normalize] failed ${township.name_en}: ${row.normalization_error}`);
    return "failed";
  }
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
  let fromJson: string | null = null;
  let input: string | null = null;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--all") all = true;
    else if (a === "--force") force = true;
    else if (a === "--township") township = argv[++i]?.trim() || null;
    else if (a === "--from-json") fromJson = argv[++i]?.trim() || null;
    else if (a === "--input") input = argv[++i]?.trim() || null;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return { all, force, township, fromJson, input, help };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(`normalize completed Deep Research reports

  --township <public_id>
  --all
  --force
  --from-json <file>   validate/write a prebuilt JSON (no Gemini call)
`);
    return 0;
  }

  const paths = researchPaths();
  if (opts.input) {
    paths.inputPath = resolve(process.cwd(), opts.input);
  }
  const state = loadState(paths.statePath);
  const townships = loadTownships(paths.inputPath);

  if (opts.fromJson) {
    const raw = JSON.parse(readFileSync(opts.fromJson, "utf8"));
    const doc = parseNormalizedDocument(raw);
    mkdirSync(paths.normalizedDir, { recursive: true });
    const out = normalizedOutputPath(
      paths.normalizedDir,
      doc.research_run.township_public_id,
    );
    writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    console.log(`[normalize] wrote validated ${out} (${doc.candidates.length} candidates)`);
    return 0;
  }

  if (!opts.all && !opts.township) {
    throw new Error("Specify --township <id> or --all");
  }

  const selected = opts.township
    ? townships.filter((t) => t.public_id === opts.township)
    : townships;
  if (selected.length === 0) throw new Error("No matching township");

  const apiKey = process.env.GEMINI_API_KEY?.trim() || "";
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for normalize");
  const model =
    process.env.TOURISM_NORMALIZE_MODEL?.trim() || DEFAULT_NORMALIZE_MODEL;
  const client = createGeminiClient(apiKey);

  let failed = 0;
  for (const township of selected) {
    const row = state.townships[township.public_id];
    if (!row) {
      console.warn(`[normalize] no state for ${township.public_id}; skip`);
      continue;
    }
    const result = await normalizeTownship({
      township,
      row,
      paths,
      client,
      model,
      force: opts.force,
    });
    if (result === "failed") failed += 1;
    if (result === "completed") {
      console.log(
        `[normalize] ${township.name_en} → ${row.normalized_file} (${NORMALIZE_PROMPT_VERSION})`,
      );
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
