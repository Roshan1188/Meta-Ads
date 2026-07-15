import "server-only";

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

import { anthropic, COPY_MODEL, isAnthropicConfigured } from "./anthropic";
import { generateStructuredGemini, isGeminiConfigured } from "./gemini";

/**
 * The single door to text generation. analyze/copy/plan call this — they never touch
 * a provider SDK directly, so the choice of Gemini vs Claude lives in one place.
 *
 * Order is deliberate: Gemini first (free tier), then Anthropic (paid, higher quality)
 * if its key is set. If neither is configured, `isAiConfigured` is false and the caller
 * returns clearly-labelled mock data instead.
 */
export const isAiConfigured = isGeminiConfigured || isAnthropicConfigured;

/** Which provider a real call will use — surfaced so the UI can be honest about it. */
export const aiProvider: "gemini" | "anthropic" | "mock" = isGeminiConfigured
  ? "gemini"
  : isAnthropicConfigured
    ? "anthropic"
    : "mock";

type Effort = "low" | "medium" | "high";

export async function generateStructured<T>(input: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Only affects Claude; Gemini Flash ignores it. */
  effort?: Effort;
  maxTokens?: number;
}): Promise<T> {
  if (isGeminiConfigured) {
    return generateStructuredGemini(input);
  }

  if (isAnthropicConfigured) {
    const response = await anthropic().messages.parse({
      model: COPY_MODEL,
      max_tokens: input.maxTokens ?? 8192,
      thinking: { type: "adaptive" },
      output_config: {
        effort: input.effort ?? "high",
        format: zodOutputFormat(input.schema as z.ZodType),
      },
      system: input.system,
      messages: [{ role: "user", content: input.user }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("The model declined this request.");
    }
    if (!response.parsed_output) {
      throw new Error("The model returned an unusable response. Try again.");
    }
    return response.parsed_output as T;
  }

  // Should never reach here — callers check isAiConfigured first.
  throw new Error("No AI provider is configured.");
}
