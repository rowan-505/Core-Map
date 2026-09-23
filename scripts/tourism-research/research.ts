/**
 * Core researchTownship flow: submit → persist ID → poll → save raw report.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  extractReportText,
  formatInteractionError,
  withRetries,
} from "./gemini";
import {
  assertTownshipIdentity,
  extractPromptVersion,
  renderResearchPrompt,
  townshipKey,
} from "./prompt";
import {
  ensureTownshipState,
  saveState,
  shouldRunFailed,
  shouldSkipCompleted,
} from "./state";
import type {
  GeminiClient,
  ResearchConfig,
  ResearchPaths,
  ResearchStateFile,
  TownshipInput,
} from "./types";

export type ResearchTownshipDeps = {
  client: GeminiClient;
  paths: ResearchPaths;
  config: ResearchConfig;
  promptTemplate: string;
  state: ResearchStateFile;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildRawReport(opts: {
  township: TownshipInput;
  interactionId: string;
  agent: string;
  promptVersion: string;
  researchedAt: string;
  reportBody: string;
}): string {
  const t = opts.township;
  return [
    "---",
    `township_public_id: ${t.public_id}`,
    `name_en: ${t.name_en}`,
    `name_mm: ${t.name_mm}`,
    `region_en: ${t.region_en}`,
    `researched_at: ${opts.researchedAt}`,
    `gemini_interaction_id: ${opts.interactionId}`,
    `prompt_version: ${opts.promptVersion}`,
    `agent: ${opts.agent}`,
    "phase: 4-raw-only",
    "note: Raw Deep Research output. Not normalized. Not imported to production DB.",
    "---",
    "",
    opts.reportBody.trim(),
    "",
  ].join("\n");
}

export function rawOutputPath(rawDir: string, key: string): string {
  return join(rawDir, `${key}.md`);
}

/**
 * Research one township end-to-end (or skip/recover per state rules).
 */
export async function researchTownship(
  townshipInput: TownshipInput,
  deps: ResearchTownshipDeps,
): Promise<"skipped" | "completed" | "failed"> {
  const township = assertTownshipIdentity(townshipInput);
  const key = townshipKey(township);
  const row = ensureTownshipState(deps.state, township);
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const promptVersion = extractPromptVersion(deps.promptTemplate);

  if (shouldSkipCompleted(row, { force: deps.config.force })) {
    console.log(`[tourism-research] skip completed ${township.name_en} (${key})`);
    return "skipped";
  }

  if (!shouldRunFailed(row, deps.config)) {
    console.log(`[tourism-research] skip failed ${township.name_en} (${key}); use --retry-failed or --force`);
    return "skipped";
  }

  if (deps.config.dryRun) {
    const prompt = renderResearchPrompt(deps.promptTemplate, township);
    console.log(`[tourism-research] dry-run ${township.name_en}: prompt ${prompt.length} chars`);
    return "skipped";
  }

  // Recover an in-flight job when possible.
  if (row.status === "running" && row.interaction_id && !deps.config.force) {
    console.log(
      `[tourism-research] resume running ${township.name_en} interaction=${row.interaction_id}`,
    );
    return pollAndFinalize(township, row, deps, promptVersion, now, sleep);
  }

  row.status = "running";
  row.attempts += 1;
  row.started_at = now().toISOString();
  row.completed_at = null;
  row.error = null;
  row.agent = deps.config.agent;
  row.prompt_version = promptVersion;
  row.interaction_id = null;
  saveState(deps.paths.statePath, deps.state);

  const prompt = renderResearchPrompt(deps.promptTemplate, township);

  try {
    const created = await withRetries(
      () => deps.client.createDeepResearch(prompt, deps.config.agent),
      { maxAttempts: deps.config.maxCreateRetries, label: `create:${key}`, sleepMs: sleep },
    );
    if (!created.id) {
      throw new Error("Deep Research create returned no interaction id");
    }
    row.interaction_id = created.id;
    saveState(deps.paths.statePath, deps.state);
    console.log(
      `[tourism-research] started ${township.name_en} interaction=${created.id}`,
    );
    return pollAndFinalize(township, row, deps, promptVersion, now, sleep);
  } catch (err) {
    row.status = "failed";
    row.error = err instanceof Error ? err.message : String(err);
    row.completed_at = now().toISOString();
    saveState(deps.paths.statePath, deps.state);
    console.error(`[tourism-research] failed ${township.name_en}: ${row.error}`);
    return "failed";
  }
}

async function pollAndFinalize(
  township: TownshipInput,
  row: ReturnType<typeof ensureTownshipState>,
  deps: ResearchTownshipDeps,
  promptVersion: string,
  now: () => Date,
  sleep: (ms: number) => Promise<void>,
): Promise<"completed" | "failed"> {
  const key = townshipKey(township);
  const interactionId = row.interaction_id;
  if (!interactionId) {
    row.status = "failed";
    row.error = "Missing interaction_id while running";
    row.completed_at = now().toISOString();
    saveState(deps.paths.statePath, deps.state);
    return "failed";
  }

  for (let i = 0; i < deps.config.maxPollAttempts; i++) {
    let interaction;
    try {
      interaction = await withRetries(
        () => deps.client.getInteraction(interactionId),
        { maxAttempts: deps.config.maxCreateRetries, label: `poll:${key}`, sleepMs: sleep },
      );
    } catch (err) {
      row.status = "failed";
      row.error = err instanceof Error ? err.message : String(err);
      row.completed_at = now().toISOString();
      saveState(deps.paths.statePath, deps.state);
      return "failed";
    }

    if (interaction.status === "completed") {
      const researchedAt = now().toISOString();
      const body = extractReportText(interaction);
      const report = buildRawReport({
        township,
        interactionId,
        agent: deps.config.agent,
        promptVersion,
        researchedAt,
        reportBody: body,
      });
      mkdirSync(deps.paths.rawDir, { recursive: true });
      const outPath = rawOutputPath(deps.paths.rawDir, key);
      writeFileSync(outPath, report, "utf8");
      row.status = "completed";
      row.raw_output_path = outPath;
      row.completed_at = researchedAt;
      row.error = null;
      row.agent = deps.config.agent;
      row.prompt_version = promptVersion;
      saveState(deps.paths.statePath, deps.state);
      console.log(`[tourism-research] completed ${township.name_en} → ${outPath}`);
      return "completed";
    }

    if (interaction.status === "failed" || interaction.status === "cancelled") {
      row.status = "failed";
      row.error = formatInteractionError(interaction.error) || interaction.status;
      row.completed_at = now().toISOString();
      saveState(deps.paths.statePath, deps.state);
      console.error(`[tourism-research] job failed ${township.name_en}: ${row.error}`);
      return "failed";
    }

    await sleep(deps.config.pollIntervalMs);
  }

  row.status = "failed";
  row.error = `Timed out after ${deps.config.maxPollAttempts} polls`;
  row.completed_at = now().toISOString();
  saveState(deps.paths.statePath, deps.state);
  return "failed";
}

/** Simple promise pool for low concurrency. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, concurrency);
  const results: R[] = new Array(items.length);
  let next = 0;

  async function runOne(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runOne()));
  return results;
}
