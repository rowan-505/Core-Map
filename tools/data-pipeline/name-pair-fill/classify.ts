import { looksLatin, looksMixedScript, looksMyanmar, trimName } from "./romanize.js";
import { isMajorRoadClass } from "./road-en-to-mm.js";

export type EntityType =
  | "place"
  | "settlement"
  | "admin_area"
  | "street"
  | "building"
  | "transport_stop"
  | "transport_terminal";

export type Direction = "mm_to_en" | "en_to_mm" | "split_mixed" | "fix_false_pair";

export type FillAction =
  | {
      kind: "auto";
      entityType: EntityType;
      entityId: number;
      entityPublicId: string | null;
      direction: Direction;
      sourceName: string;
      proposedMm: string | null;
      proposedEn: string | null;
      confidence: number;
      reason: string;
    }
  | {
      kind: "review";
      entityType: EntityType;
      entityId: number;
      entityPublicId: string | null;
      direction: Direction;
      sourceName: string;
      proposedMm: string | null;
      proposedEn: string | null;
      confidence: number;
      reason: string;
    }
  | { kind: "skip"; reason: string };

export function classifyMmEnGap(args: {
  entityType: EntityType;
  entityId: number;
  entityPublicId?: string | null;
  mm: string | null;
  en: string | null;
  seed?: string | null;
  importanceScore?: number | null;
  isVerified?: boolean | null;
  roadClass?: string | null;
  stopType?: string | null;
  proposedEn?: string | null;
  proposedMm?: string | null;
  proposedConfidence?: number;
}): FillAction {
  const mm = trimName(args.mm);
  const en = trimName(args.en);
  const seed = trimName(args.seed);
  const important = isImportantEntity(args);

  if (mm && en && mm === en) {
    if (looksMyanmar(mm) && !looksLatin(mm)) {
      return finish({
        kind: important ? "review" : "auto",
        direction: "fix_false_pair",
        sourceName: mm,
        proposedMm: mm,
        proposedEn: args.proposedEn ?? null,
        confidence: args.proposedConfidence ?? 70,
        reason: "false_pair_same_mm_both_sides",
        args,
      });
    }
    if (looksLatin(en) && !looksMyanmar(en)) {
      return finish({
        kind: important ? "review" : "auto",
        direction: "fix_false_pair",
        sourceName: en,
        proposedMm: args.proposedMm ?? null,
        proposedEn: en,
        confidence: args.proposedConfidence ?? 60,
        reason: "false_pair_same_en_both_sides",
        args,
      });
    }
  }

  if (mm && en && mm !== en) {
    return { kind: "skip", reason: "already_true_pair" };
  }

  const mixedSeed = seed && looksMixedScript(seed) ? seed : null;
  if (mixedSeed && (!mm || !en)) {
    return finish({
      kind: "review",
      direction: "split_mixed",
      sourceName: mixedSeed,
      proposedMm: args.proposedMm ?? null,
      proposedEn: args.proposedEn ?? null,
      confidence: args.proposedConfidence ?? 40,
      reason: "mixed_script_needs_split",
      args,
    });
  }

  // Missing EN, have MM
  if (mm && !en) {
    if (args.proposedEn) {
      return finish({
        kind: important && (args.proposedConfidence ?? 85) < 75 ? "review" : "auto",
        direction: "mm_to_en",
        sourceName: mm,
        proposedMm: mm,
        proposedEn: args.proposedEn,
        confidence: args.proposedConfidence ?? 85,
        reason: "mm_present_en_missing_romanize",
        args,
      });
    }
    return finish({
      kind: "review",
      direction: "mm_to_en",
      sourceName: mm,
      proposedMm: mm,
      proposedEn: null,
      confidence: 30,
      reason: "mm_present_en_missing_no_proposal",
      args,
    });
  }

  // Missing MM, have EN
  if (en && !mm) {
    if (args.proposedMm && (args.proposedConfidence ?? 0) >= 70) {
      return finish({
        kind: "auto",
        direction: "en_to_mm",
        sourceName: en,
        proposedMm: args.proposedMm,
        proposedEn: en,
        confidence: args.proposedConfidence ?? 72,
        reason: "en_present_mm_missing_pattern",
        args,
      });
    }
    if (important) {
      return finish({
        kind: "review",
        direction: "en_to_mm",
        sourceName: en,
        proposedMm: args.proposedMm ?? null,
        proposedEn: en,
        confidence: args.proposedConfidence ?? 40,
        reason: "important_en_only_needs_mm",
        args,
      });
    }
    return { kind: "skip", reason: "en_only_not_important" };
  }

  // Neither — try seed
  if (!mm && !en && seed) {
    if (looksMyanmar(seed) && !looksLatin(seed)) {
      return finish({
        kind: "auto",
        direction: "mm_to_en",
        sourceName: seed,
        proposedMm: seed,
        proposedEn: args.proposedEn ?? null,
        confidence: args.proposedConfidence ?? 85,
        reason: "seed_mm_only",
        args,
      });
    }
    if (looksLatin(seed) && !looksMyanmar(seed)) {
      if (args.proposedMm && (args.proposedConfidence ?? 0) >= 70) {
        return finish({
          kind: "auto",
          direction: "en_to_mm",
          sourceName: seed,
          proposedMm: args.proposedMm,
          proposedEn: seed,
          confidence: args.proposedConfidence ?? 72,
          reason: "seed_en_pattern_mm",
          args,
        });
      }
      if (important) {
        return finish({
          kind: "review",
          direction: "en_to_mm",
          sourceName: seed,
          proposedMm: null,
          proposedEn: seed,
          confidence: 35,
          reason: "important_seed_en_only",
          args,
        });
      }
      return { kind: "skip", reason: "seed_en_not_important" };
    }
  }

  return { kind: "skip", reason: "no_actionable_seed" };
}

function isImportantEntity(args: {
  entityType: EntityType;
  importanceScore?: number | null;
  isVerified?: boolean | null;
  roadClass?: string | null;
  stopType?: string | null;
}): boolean {
  if (args.entityType === "admin_area" || args.entityType === "settlement") return true;
  if (args.entityType === "transport_terminal") return true;
  if (args.isVerified) return true;
  if ((args.importanceScore ?? 0) >= 70) return true;
  if (args.entityType === "street" && isMajorRoadClass(args.roadClass)) return true;
  if (
    args.entityType === "transport_stop" &&
    args.stopType &&
    ["station", "terminal", "ferry_terminal"].includes(args.stopType.toLowerCase())
  ) {
    return true;
  }
  return false;
}

function finish(args: {
  kind: "auto" | "review";
  direction: Direction;
  sourceName: string;
  proposedMm: string | null;
  proposedEn: string | null;
  confidence: number;
  reason: string;
  args: {
    entityType: EntityType;
    entityId: number;
    entityPublicId?: string | null;
  };
}): FillAction {
  if (args.kind === "auto" && !args.proposedMm && !args.proposedEn) {
    return {
      kind: "review",
      entityType: args.args.entityType,
      entityId: args.args.entityId,
      entityPublicId: args.args.entityPublicId ?? null,
      direction: args.direction,
      sourceName: args.sourceName,
      proposedMm: null,
      proposedEn: null,
      confidence: args.confidence,
      reason: `${args.reason}_missing_proposal`,
    };
  }
  // Auto still needs the side being filled
  if (args.kind === "auto") {
    if (
      (args.direction === "mm_to_en" || args.direction === "fix_false_pair") &&
      !args.proposedEn &&
      args.proposedMm
    ) {
      return {
        kind: "review",
        entityType: args.args.entityType,
        entityId: args.args.entityId,
        entityPublicId: args.args.entityPublicId ?? null,
        direction: args.direction,
        sourceName: args.sourceName,
        proposedMm: args.proposedMm,
        proposedEn: null,
        confidence: args.confidence,
        reason: `${args.reason}_no_en_proposal`,
      };
    }
  }
  return {
    kind: args.kind,
    entityType: args.args.entityType,
    entityId: args.args.entityId,
    entityPublicId: args.args.entityPublicId ?? null,
    direction: args.direction,
    sourceName: args.sourceName,
    proposedMm: args.proposedMm,
    proposedEn: args.proposedEn,
    confidence: args.confidence,
    reason: args.reason,
  };
}
