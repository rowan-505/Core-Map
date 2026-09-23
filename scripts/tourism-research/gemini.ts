/**
 * Gemini Interactions API client for Deep Research (official REST).
 *
 * Auth: GEMINI_API_KEY via x-goog-api-key
 * Docs: https://ai.google.dev/gemini-api/docs/deep-research
 */

import type { GeminiClient, GeminiInteraction } from "./types";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiApiError extends Error {
  readonly statusCode: number;
  readonly body: string;
  readonly retryable: boolean;

  constructor(message: string, statusCode: number, body: string) {
    super(message);
    this.name = "GeminiApiError";
    this.statusCode = statusCode;
    this.body = body;
    this.retryable = statusCode === 429 || statusCode >= 500;
  }
}

export type FetchLike = typeof fetch;

export function createGeminiClient(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): GeminiClient {
  if (!apiKey.trim()) {
    throw new Error("GEMINI_API_KEY is required");
  }

  async function request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<GeminiInteraction> {
    const res = await fetchImpl(`${BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new GeminiApiError(
        `Gemini API ${method} ${path} failed (${res.status})`,
        res.status,
        text,
      );
    }
    return JSON.parse(text) as GeminiInteraction;
  }

  return {
    async createDeepResearch(input: string, agent: string) {
      // Default tools include Google Search + URL Context + Code Execution.
      // Explicitly enable search + url_context for web research grounding.
      return request("POST", "/interactions", {
        input,
        agent,
        background: true,
        agent_config: {
          type: "deep-research",
          collaborative_planning: false,
          thinking_summaries: "none",
          visualization: "off",
        },
        tools: [{ type: "google_search" }, { type: "url_context" }],
      });
    },

    async getInteraction(id: string) {
      return request("GET", `/interactions/${encodeURIComponent(id)}`);
    },

    async generateJson(input) {
      const res = await fetchImpl(
        `${BASE_URL}/models/${encodeURIComponent(input.model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: input.prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              ...(input.responseSchema
                ? { responseSchema: input.responseSchema }
                : {}),
            },
          }),
        },
      );
      const text = await res.text();
      if (!res.ok) {
        throw new GeminiApiError(
          `Gemini generateContent failed (${res.status})`,
          res.status,
          text,
        );
      }
      const parsed = JSON.parse(text) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const rawText =
        parsed.candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? "")
          .join("")
          .trim() ?? "";
      if (!rawText) {
        throw new Error("Gemini generateContent returned empty JSON text");
      }
      return JSON.parse(rawText) as unknown;
    },
  };
}

/** Extract the final report text from a completed interaction payload. */
export function extractReportText(interaction: GeminiInteraction): string {
  if (Array.isArray(interaction.steps) && interaction.steps.length > 0) {
    const last = interaction.steps[interaction.steps.length - 1];
    const texts = (last?.content ?? [])
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .filter(Boolean);
    if (texts.length > 0) return texts.join("\n\n");
  }
  if (Array.isArray(interaction.output)) {
    const texts = interaction.output
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .filter(Boolean);
    if (texts.length > 0) return texts.join("\n\n");
  }
  return JSON.stringify(interaction, null, 2);
}

export function formatInteractionError(error: unknown): string {
  if (error == null) return "unknown error";
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export async function withRetries<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts: number; label: string; sleepMs?: (n: number) => Promise<void> },
): Promise<T> {
  const sleep =
    opts.sleepMs ??
    (async (ms: number) => {
      await new Promise((r) => setTimeout(r, ms));
    });
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof GeminiApiError && err.retryable;
      if (!retryable || attempt >= opts.maxAttempts) throw err;
      const backoff = Math.min(30_000, 1000 * 2 ** (attempt - 1));
      console.warn(
        `[tourism-research] ${opts.label} transient failure (attempt ${attempt}/${opts.maxAttempts}); retry in ${backoff}ms`,
      );
      await sleep(backoff);
    }
  }
  throw lastErr;
}
