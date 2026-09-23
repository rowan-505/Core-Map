/**
 * Types for CoreMap tourism Deep Research runner (dev script only).
 */

export const PROMPT_VERSION = "2026-09-21.1";

/** Current official Deep Research Max agent (Interactions API, April 2026 preview). */
export const DEFAULT_DEEP_RESEARCH_AGENT = "deep-research-max-preview-04-2026";

/** Faster Deep Research agent when TOURISM_RESEARCH_AGENT overrides. */
export const FAST_DEEP_RESEARCH_AGENT = "deep-research-preview-04-2026";

export type TownshipInput = {
  public_id: string;
  name_en: string;
  name_mm: string;
  region_en: string;
};

export type ResearchStatus = "pending" | "running" | "completed" | "failed";

export type TownshipState = {
  township_key: string;
  public_id: string;
  name_en: string;
  status: ResearchStatus;
  interaction_id: string | null;
  attempts: number;
  started_at: string | null;
  completed_at: string | null;
  raw_output_path: string | null;
  error: string | null;
  agent: string | null;
  prompt_version: string | null;
  normalized?: boolean;
  normalized_file?: string | null;
  normalization_error?: string | null;
  imported?: boolean;
  imported_count?: number;
  import_error?: string | null;
};

export type ResearchStateFile = {
  version: 1;
  updated_at: string | null;
  townships: Record<string, TownshipState>;
};

export type InteractionStatus =
  | "in_progress"
  | "requires_action"
  | "completed"
  | "failed"
  | "cancelled"
  | string;

export type GeminiInteraction = {
  id: string;
  status: InteractionStatus;
  agent?: string;
  error?: unknown;
  outputs?: unknown;
  steps?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
  output?: Array<{ type?: string; text?: string }>;
};

export type GeminiClient = {
  createDeepResearch(input: string, agent: string): Promise<GeminiInteraction>;
  getInteraction(id: string): Promise<GeminiInteraction>;
  generateJson(input: {
    model: string;
    prompt: string;
    responseSchema?: Record<string, unknown>;
  }): Promise<unknown>;
};

export type ResearchPaths = {
  rootDir: string;
  inputPath: string;
  promptPath: string;
  normalizePromptPath: string;
  statePath: string;
  rawDir: string;
  normalizedDir: string;
};

export type ResearchConfig = {
  apiKey: string;
  agent: string;
  normalizeModel: string;
  concurrency: number;
  pollIntervalMs: number;
  maxPollAttempts: number;
  maxCreateRetries: number;
  force: boolean;
  retryFailed: boolean;
  dryRun: boolean;
  townshipFilter: string | null;
};
