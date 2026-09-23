/**
 * Phase 5 tests: normalization validation, candidate keys, idempotent import mapping.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildCandidateKey, ensureUniqueCandidateKeys, slugify } from "./candidate-key";
import { mapDocumentToImportBatches } from "./import";
import {
  parseNormalizedDocument,
  safeParseNormalizedDocument,
} from "./normalized-schema";
import { postProcessNormalizedDoc, parseRawMetadata } from "./normalize";

const rootDir = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(rootDir, "fixtures/normalized-sample.json");

describe("normalized schema", () => {
  it("accepts fixture with attraction/food/event/guide/advisory", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const doc = parseNormalizedDocument(raw);
    assert.equal(doc.schema_version, "tourism-research-v1");
    assert.equal(doc.candidates.length, 6);
    assert.ok(doc.candidates.some((c) => c.entity_type === "food"));
    assert.ok(
      doc.candidates.find((c) => c.entity_type === "event")?.payload
        .occurrence_starts_at == null,
    );
    assert.ok(
      doc.candidates
        .find((c) => c.entity_type === "advisory")
        ?.payload.conflicts?.length,
    );
  });

  it("rejects invalid entity_type enum", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    raw.candidates[0].entity_type = "restaurant";
    const parsed = safeParseNormalizedDocument(raw);
    assert.equal(parsed.success, false);
  });

  it("rejects candidates without usable sources", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    raw.candidates[0].payload.sources = [];
    const parsed = safeParseNormalizedDocument(raw);
    assert.equal(parsed.success, false);
  });

  it("allows null unknown optional fields", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const event = raw.candidates.find((c: { entity_type: string }) => c.entity_type === "event");
    assert.equal(event.payload.occurrence_starts_at, null);
    assert.equal(event.payload.occurrence_ends_at, null);
    parseNormalizedDocument(raw);
  });
});

describe("candidate keys", () => {
  it("builds deterministic keys", () => {
    assert.equal(slugify("Ye Le Pagoda"), "ye-le-pagoda");
    assert.equal(
      buildCandidateKey("attraction", "Ye Le Pagoda"),
      "attraction:ye-le-pagoda",
    );
    assert.equal(
      buildCandidateKey("food", "Mohinga"),
      buildCandidateKey("food", "Mohinga"),
    );
  });

  it("dedupes colliding keys without random ids", () => {
    const out = ensureUniqueCandidateKeys([
      {
        candidate_key: "food:mohinga",
        entity_type: "food",
        name: "Mohinga",
        payload: { sources: [{ url: "https://a.example/1" }] },
      },
      {
        candidate_key: "food:mohinga",
        entity_type: "food",
        name: "Mohinga",
        payload: { sources: [{ url: "https://b.example/2" }] },
      },
    ]);
    assert.equal(out[0]!.candidate_key, "food:mohinga");
    assert.notEqual(out[1]!.candidate_key, out[0]!.candidate_key);
    assert.match(out[1]!.candidate_key, /^food:mohinga:/);
  });
});

describe("import mapping", () => {
  it("maps only to research_candidates import shape (staging)", () => {
    const doc = parseNormalizedDocument(
      JSON.parse(readFileSync(fixturePath, "utf8")),
    );
    const batches = mapDocumentToImportBatches(doc);
    assert.equal(batches.length, 1);
    const first = batches[0]!.candidates[0]!;
    assert.equal(first.admin_area_public_id, doc.research_run.township_public_id);
    assert.equal(first.research_status, "new");
    assert.ok(first.candidate_key);
    assert.ok(first.research_run_id);
    assert.ok(!("create_food" in first));
    assert.ok(!("create_guide" in first));
    assert.ok(!("create_advisory" in first));
  });

  it("is idempotent for the same run+key payload", () => {
    const doc = parseNormalizedDocument(
      JSON.parse(readFileSync(fixturePath, "utf8")),
    );
    const a = mapDocumentToImportBatches(doc)[0]!.candidates;
    const b = mapDocumentToImportBatches(doc)[0]!.candidates;
    assert.deepEqual(
      a.map((x) => x.candidate_key),
      b.map((x) => x.candidate_key),
    );
    assert.deepEqual(
      a.map((x) => x.research_run_id),
      b.map((x) => x.research_run_id),
    );
  });
});

describe("raw metadata + post-process", () => {
  it("parses raw front-matter metadata", () => {
    const meta = parseRawMetadata(`---
township_public_id: 00000000-0000-4000-8000-000000000001
name_en: Kyauktan
name_mm: test
region_en: Yangon Region
researched_at: 2026-09-21T01:00:00.000Z
gemini_interaction_id: job-abc
prompt_version: 2026-09-21.1
agent: deep-research-max-preview-04-2026
---
body`);
    assert.equal(meta.interactionId, "job-abc");
    assert.equal(meta.publicId, "00000000-0000-4000-8000-000000000001");
  });

  it("overwrites research_run identity from canonical township", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    raw.research_run.township_name_en = "WRONG";
    const doc = postProcessNormalizedDoc(raw, {
      public_id: "00000000-0000-4000-8000-000000000001",
      name_en: "Kyauktan",
      name_mm: "ကျောက်တန်း",
      region_en: "Yangon Region",
      interaction_id: "interaction-fixture-1",
      researched_at: "2026-09-21T01:00:00.000Z",
      prompt_version: "2026-09-21.1",
    });
    assert.equal(doc.research_run.township_name_en, "Kyauktan");
  });
});
