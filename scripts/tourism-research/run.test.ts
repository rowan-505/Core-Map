/**
 * Unit tests for tourism Deep Research runner (mocked; no paid API calls).
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { extractReportText, GeminiApiError, withRetries } from "./gemini";
import {
  assertTownshipIdentity,
  extractPromptVersion,
  loadPromptTemplate,
  renderResearchPrompt,
  townshipKey,
} from "./prompt";
import { buildRawReport, mapPool, researchTownship } from "./research";
import {
  emptyState,
  ensureTownshipState,
  loadState,
  saveState,
  shouldRunFailed,
  shouldSkipCompleted,
} from "./state";
import type { GeminiClient, GeminiInteraction, TownshipInput } from "./types";

const rootDir = dirname(fileURLToPath(import.meta.url));
const promptPath = resolve(rootDir, "prompts/research.md");

const sampleTownship: TownshipInput = {
  public_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  name_en: "Kyauktan",
  name_mm: "ကျောက်တန်း",
  region_en: "Yangon Region",
};

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "tourism-research-"));
  tempDirs.push(dir);
  const rawDir = join(dir, "raw");
  const statePath = join(dir, "state.json");
  writeFileSync(statePath, JSON.stringify(emptyState(), null, 2));
  return {
    dir,
    paths: {
      rootDir: dir,
      inputPath: join(dir, "townships.json"),
      promptPath,
      normalizePromptPath: resolve(rootDir, "prompts/normalize.md"),
      statePath,
      rawDir,
      normalizedDir: join(dir, "normalized"),
    },
  };
}

describe("prompt rendering", () => {
  it("loads prompt version and injects township identity", () => {
    const template = loadPromptTemplate(promptPath);
    const version = extractPromptVersion(template);
    assert.equal(version, "2026-09-21.1");

    const rendered = renderResearchPrompt(template, sampleTownship);
    assert.match(rendered, /aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/);
    assert.match(rendered, /Kyauktan/);
    assert.match(rendered, /ကျောက်တန်း/);
    assert.match(rendered, /Yangon Region/);
    assert.doesNotMatch(rendered, /\{\{/);
    assert.match(rendered, /editorial_recommendation/);
    assert.match(rendered, /traditionality_reference/);
    assert.match(rendered, /Model memory is NOT evidence/i);
  });

  it("rejects incomplete township identity", () => {
    assert.throws(() =>
      assertTownshipIdentity({
        public_id: "",
        name_en: "X",
        name_mm: "Y",
        region_en: "Z",
      }),
    );
  });

  it("uses public_id as stable township key", () => {
    assert.equal(townshipKey(sampleTownship), sampleTownship.public_id);
  });
});

describe("state persistence and restartability", () => {
  it("persists and reloads township state", () => {
    const { paths } = tempWorkspace();
    const state = loadState(paths.statePath);
    const row = ensureTownshipState(state, sampleTownship);
    row.status = "completed";
    row.interaction_id = "interaction-1";
    row.raw_output_path = "/tmp/out.md";
    saveState(paths.statePath, state);

    const reloaded = loadState(paths.statePath);
    assert.equal(reloaded.townships[sampleTownship.public_id]?.status, "completed");
    assert.equal(
      reloaded.townships[sampleTownship.public_id]?.interaction_id,
      "interaction-1",
    );
  });

  it("skips completed unless force", () => {
    const row = ensureTownshipState(emptyState(), sampleTownship);
    row.status = "completed";
    assert.equal(shouldSkipCompleted(row, { force: false }), true);
    assert.equal(shouldSkipCompleted(row, { force: true }), false);
  });

  it("runs failed only when retry requested", () => {
    const row = ensureTownshipState(emptyState(), sampleTownship);
    row.status = "failed";
    assert.equal(shouldRunFailed(row, { force: false, retryFailed: false }), false);
    assert.equal(shouldRunFailed(row, { force: false, retryFailed: true }), true);
    assert.equal(shouldRunFailed(row, { force: true, retryFailed: false }), true);
  });
});

describe("researchTownship", () => {
  it("skips completed jobs", async () => {
    const { paths } = tempWorkspace();
    const state = loadState(paths.statePath);
    const row = ensureTownshipState(state, sampleTownship);
    row.status = "completed";
    saveState(paths.statePath, state);

    const client: GeminiClient = {
      createDeepResearch: async () => {
        throw new Error("should not create");
      },
      getInteraction: async () => {
        throw new Error("should not get");
      },
      generateJson: async () => {
        throw new Error("should not generate");
      },
    };

    const result = await researchTownship(sampleTownship, {
      client,
      paths,
      config: {
        apiKey: "test",
        agent: "deep-research-max-preview-04-2026",
        normalizeModel: "gemini-3.1-flash-lite",
        concurrency: 1,
        pollIntervalMs: 1,
        maxPollAttempts: 3,
        maxCreateRetries: 1,
        force: false,
        retryFailed: false,
        dryRun: false,
        townshipFilter: null,
      },
      promptTemplate: loadPromptTemplate(promptPath),
      state,
      sleep: async () => undefined,
    });
    assert.equal(result, "skipped");
  });

  it("creates, polls, stores raw report, and marks completed", async () => {
    const { paths } = tempWorkspace();
    const state = loadState(paths.statePath);
    let creates = 0;
    let polls = 0;

    const client: GeminiClient = {
      async createDeepResearch() {
        creates += 1;
        return { id: "job-123", status: "in_progress" };
      },
      async getInteraction(id: string) {
        assert.equal(id, "job-123");
        polls += 1;
        if (polls < 2) return { id, status: "in_progress" };
        return {
          id,
          status: "completed",
          steps: [{ content: [{ type: "text", text: "# Report\n\nMohinga is popular." }] }],
        };
      },
      generateJson: async () => ({ ok: true }),
    };

    const result = await researchTownship(sampleTownship, {
      client,
      paths,
      config: {
        apiKey: "test",
        agent: "deep-research-max-preview-04-2026",
        normalizeModel: "gemini-3.1-flash-lite",
        concurrency: 1,
        pollIntervalMs: 1,
        maxPollAttempts: 5,
        maxCreateRetries: 1,
        force: false,
        retryFailed: false,
        dryRun: false,
        townshipFilter: null,
      },
      promptTemplate: loadPromptTemplate(promptPath),
      state,
      now: () => new Date("2026-09-21T01:00:00.000Z"),
      sleep: async () => undefined,
    });

    assert.equal(result, "completed");
    assert.equal(creates, 1);
    assert.ok(polls >= 2);
    const row = state.townships[sampleTownship.public_id]!;
    assert.equal(row.status, "completed");
    assert.equal(row.interaction_id, "job-123");
    assert.ok(row.raw_output_path);
    const raw = readFileSync(row.raw_output_path!, "utf8");
    assert.match(raw, /township_public_id: aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/);
    assert.match(raw, /gemini_interaction_id: job-123/);
    assert.match(raw, /prompt_version: 2026-09-21.1/);
    assert.match(raw, /agent: deep-research-max-preview-04-2026/);
    assert.match(raw, /Mohinga is popular/);
  });

  it("does not mark completed when API create fails", async () => {
    const { paths } = tempWorkspace();
    const state = loadState(paths.statePath);

    const client: GeminiClient = {
      async createDeepResearch() {
        throw new GeminiApiError("boom", 500, "server error");
      },
      async getInteraction() {
        throw new Error("should not poll");
      },
      generateJson: async () => ({ ok: true }),
    };

    const result = await researchTownship(sampleTownship, {
      client,
      paths,
      config: {
        apiKey: "test",
        agent: "deep-research-max-preview-04-2026",
        normalizeModel: "gemini-3.1-flash-lite",
        concurrency: 1,
        pollIntervalMs: 1,
        maxPollAttempts: 3,
        maxCreateRetries: 1,
        force: false,
        retryFailed: false,
        dryRun: false,
        townshipFilter: null,
      },
      promptTemplate: loadPromptTemplate(promptPath),
      state,
      sleep: async () => undefined,
    });

    assert.equal(result, "failed");
    assert.equal(state.townships[sampleTownship.public_id]?.status, "failed");
    assert.equal(state.townships[sampleTownship.public_id]?.raw_output_path, null);
  });

  it("recovers a running interaction without creating a new job", async () => {
    const { paths } = tempWorkspace();
    const state = loadState(paths.statePath);
    const row = ensureTownshipState(state, sampleTownship);
    row.status = "running";
    row.interaction_id = "existing-job";
    row.attempts = 1;
    saveState(paths.statePath, state);

    let creates = 0;
    const client: GeminiClient = {
      async createDeepResearch() {
        creates += 1;
        return { id: "new", status: "in_progress" };
      },
      async getInteraction(id: string) {
        assert.equal(id, "existing-job");
        return {
          id,
          status: "completed",
          steps: [{ content: [{ text: "Recovered report" }] }],
        };
      },
      generateJson: async () => ({ ok: true }),
    };

    const result = await researchTownship(sampleTownship, {
      client,
      paths,
      config: {
        apiKey: "test",
        agent: "deep-research-max-preview-04-2026",
        normalizeModel: "gemini-3.1-flash-lite",
        concurrency: 1,
        pollIntervalMs: 1,
        maxPollAttempts: 3,
        maxCreateRetries: 1,
        force: false,
        retryFailed: false,
        dryRun: false,
        townshipFilter: null,
      },
      promptTemplate: loadPromptTemplate(promptPath),
      state,
      sleep: async () => undefined,
    });

    assert.equal(result, "completed");
    assert.equal(creates, 0);
    assert.match(
      readFileSync(state.townships[sampleTownship.public_id]!.raw_output_path!, "utf8"),
      /Recovered report/,
    );
  });
});

describe("helpers", () => {
  it("extracts report text from steps", () => {
    const interaction: GeminiInteraction = {
      id: "1",
      status: "completed",
      steps: [
        { content: [{ text: "plan" }] },
        { content: [{ text: "final report" }] },
      ],
    };
    assert.equal(extractReportText(interaction), "final report");
  });

  it("builds raw report metadata header", () => {
    const md = buildRawReport({
      township: sampleTownship,
      interactionId: "abc",
      agent: "deep-research-max-preview-04-2026",
      promptVersion: "2026-09-21.1",
      researchedAt: "2026-09-21T00:00:00.000Z",
      reportBody: "body",
    });
    assert.match(md, /name_mm: ကျောက်တန်း/);
    assert.match(md, /phase: 4-raw-only/);
  });

  it("retries transient Gemini errors then succeeds", async () => {
    let n = 0;
    const value = await withRetries(
      async () => {
        n += 1;
        if (n < 3) throw new GeminiApiError("rate", 429, "slow");
        return "ok";
      },
      { maxAttempts: 3, label: "test", sleepMs: async () => undefined },
    );
    assert.equal(value, "ok");
    assert.equal(n, 3);
  });

  it("mapPool respects concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const items = [1, 2, 3, 4];
    const out = await mapPool(items, 2, async (n) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      return n * 2;
    });
    assert.deepEqual(out, [2, 4, 6, 8]);
    assert.ok(maxActive <= 2);
  });
});
