/**
 * Persistable runner state for restartability.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { ResearchStateFile, TownshipInput, TownshipState } from "./types";
import { townshipKey } from "./prompt";

export function emptyState(): ResearchStateFile {
  return { version: 1, updated_at: null, townships: {} };
}

export function loadState(statePath: string): ResearchStateFile {
  if (!existsSync(statePath)) return emptyState();
  const raw = readFileSync(statePath, "utf8").trim();
  if (!raw) return emptyState();
  const parsed = JSON.parse(raw) as ResearchStateFile;
  if (parsed.version !== 1 || typeof parsed.townships !== "object" || !parsed.townships) {
    throw new Error(`Invalid state file: ${statePath}`);
  }
  return parsed;
}

export function saveState(statePath: string, state: ResearchStateFile): void {
  mkdirSync(dirname(statePath), { recursive: true });
  const next: ResearchStateFile = {
    ...state,
    updated_at: new Date().toISOString(),
  };
  writeFileSync(statePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export function ensureTownshipState(
  state: ResearchStateFile,
  township: TownshipInput,
): TownshipState {
  const key = townshipKey(township);
  const existing = state.townships[key];
  if (existing) {
    existing.public_id = township.public_id;
    existing.name_en = township.name_en;
    existing.township_key = key;
    return existing;
  }
  const created: TownshipState = {
    township_key: key,
    public_id: township.public_id,
    name_en: township.name_en,
    status: "pending",
    interaction_id: null,
    attempts: 0,
    started_at: null,
    completed_at: null,
    raw_output_path: null,
    error: null,
    agent: null,
    prompt_version: null,
    normalized: false,
    normalized_file: null,
    normalization_error: null,
    imported: false,
    imported_count: 0,
    import_error: null,
  };
  state.townships[key] = created;
  return created;
}

export function shouldSkipCompleted(
  row: TownshipState,
  opts: { force: boolean },
): boolean {
  return row.status === "completed" && !opts.force;
}

export function shouldRunFailed(
  row: TownshipState,
  opts: { force: boolean; retryFailed: boolean },
): boolean {
  if (row.status !== "failed") return true;
  return opts.force || opts.retryFailed;
}
