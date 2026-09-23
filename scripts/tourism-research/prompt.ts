/**
 * Prompt rendering for township Deep Research.
 */

import { readFileSync } from "node:fs";

import { PROMPT_VERSION, type TownshipInput } from "./types";

const PLACEHOLDERS = [
  "public_id",
  "name_en",
  "name_mm",
  "region_en",
] as const;

export function extractPromptVersion(template: string): string {
  const match = template.match(/prompt_version:\s*([^\s]+)/i);
  return match?.[1]?.trim() || PROMPT_VERSION;
}

export function renderResearchPrompt(
  template: string,
  township: TownshipInput,
): string {
  let out = template;
  for (const key of PLACEHOLDERS) {
    const value = township[key];
    if (!value || !String(value).trim()) {
      throw new Error(`Township ${township.public_id || "?"} missing ${key}`);
    }
    out = out.split(`{{${key}}}`).join(String(value).trim());
  }
  if (out.includes("{{")) {
    throw new Error("Unresolved prompt placeholders remain after render");
  }
  return out;
}

export function loadPromptTemplate(promptPath: string): string {
  return readFileSync(promptPath, "utf8");
}

export function assertTownshipIdentity(township: TownshipInput): TownshipInput {
  const public_id = township.public_id?.trim();
  const name_en = township.name_en?.trim();
  const name_mm = township.name_mm?.trim();
  const region_en = township.region_en?.trim();
  if (!public_id) throw new Error("Township public_id is required");
  if (!name_en) throw new Error(`Township ${public_id}: name_en is required`);
  if (!name_mm) throw new Error(`Township ${public_id}: name_mm is required`);
  if (!region_en) throw new Error(`Township ${public_id}: region_en is required`);
  return { public_id, name_en, name_mm, region_en };
}

/** Stable filesystem key from canonical public_id. */
export function townshipKey(township: TownshipInput): string {
  return assertTownshipIdentity(township).public_id;
}
