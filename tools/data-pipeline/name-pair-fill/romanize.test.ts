import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { romanizeMyanmarToEnglish, looksMixedScript } from "./romanize.js";
import { englishRoadNameToMyanmar } from "./road-en-to-mm.js";
import { classifyMmEnGap } from "./classify.js";

describe("romanizeMyanmarToEnglish", () => {
  it("romanizes a Myanmar road phrase", () => {
    const result = romanizeMyanmarToEnglish("ပြည်လမ်း");
    assert.ok(result);
    assert.match(result.text, /Road/i);
    assert.ok(result.confidence >= 70);
  });

  it("returns null for Latin-only input", () => {
    assert.equal(romanizeMyanmarToEnglish("Pyay Road"), null);
  });
});

describe("englishRoadNameToMyanmar", () => {
  it("maps Road suffix when no leftover Latin proper noun", () => {
    // Pure "Road 5" style
    const result = englishRoadNameToMyanmar("Road 5");
    assert.ok(result);
    assert.match(result.text, /လမ်း/);
  });

  it("refuses Pyay Road because proper noun remains", () => {
    assert.equal(englishRoadNameToMyanmar("Pyay Road"), null);
  });
});

describe("classifyMmEnGap", () => {
  it("auto-fills MM to EN when proposal exists", () => {
    const action = classifyMmEnGap({
      entityType: "place",
      entityId: 1,
      mm: "ပြည်လမ်း",
      en: null,
      proposedEn: "Pyay Road",
      proposedConfidence: 85,
    });
    assert.equal(action.kind, "auto");
  });

  it("queues important EN-only for review", () => {
    const action = classifyMmEnGap({
      entityType: "place",
      entityId: 2,
      mm: null,
      en: "Shwedagon Pagoda",
      importanceScore: 90,
    });
    assert.equal(action.kind, "review");
  });

  it("skips unimportant EN-only", () => {
    const action = classifyMmEnGap({
      entityType: "place",
      entityId: 3,
      mm: null,
      en: "Corner Shop",
      importanceScore: 10,
    });
    assert.equal(action.kind, "skip");
  });

  it("reviews mixed script", () => {
    assert.equal(looksMixedScript("ပြည် Pyay"), true);
    const action = classifyMmEnGap({
      entityType: "place",
      entityId: 4,
      mm: null,
      en: null,
      seed: "ပြည် Pyay",
    });
    assert.equal(action.kind, "review");
  });
});
