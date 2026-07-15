import "server-only";

import { GoogleGenAI } from "@google/genai";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";

/**
 * Google Gemini as the text provider. Free tier (AI Studio key, no card), which is
 * why it's the default when GEMINI_API_KEY is present. The whole LLM surface is one
 * function — `generateStructured` — so swapping providers never touches feature code.
 */

// Flash models covered by the free tier. We try them in order: each model has its
// own capacity and quota pool, so when the free tier is congested (503 "high demand"
// or 429 quota on one model), the next one usually goes through. `gemini-flash-latest`
// is an evergreen alias; the rest are concrete fallbacks. Override the first with
// GEMINI_MODEL.
// Lite models first: they carry the highest free-tier quota, so on the free plan
// they're the reliable default. The full flash model has better quality but a much
// smaller free allowance and 429s quickly — it's the last resort here.
const MODEL_CHAIN = [
  process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest",
  "gemini-2.0-flash-lite",
  "gemini-flash-latest",
];

export const GEMINI_MODEL = MODEL_CHAIN[0];

/**
 * Conditions where trying the next model in the chain is worth it: transient
 * Google-side overload/quota (429/503/500/504), and a model that simply isn't
 * available to this account (404). Auth, bad-request, and bad-shape errors won't
 * improve on another model, so those propagate immediately.
 */
function shouldTryNextModel(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|500|503|504|UNAVAILABLE|RESOURCE_EXHAUSTED|NOT_FOUND|DEADLINE|overloaded|high demand|quota|not found|not available|SHAPE_MISMATCH)\b/i.test(
    message,
  );
}

export const isGeminiConfigured = Boolean(process.env.GEMINI_API_KEY);

// Hard cap per model attempt. The SDK also retries internally, which can stack up
// to minutes when Google is congested, so we race every attempt against this and
// move to the next model on timeout rather than letting a request hang.
const REQUEST_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Gemini request timed out (UNAVAILABLE).")), ms),
    ),
  ]);
}

let client: GoogleGenAI | undefined;

function gemini(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set.");
  }
  client ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { timeout: REQUEST_TIMEOUT_MS },
  });
  return client;
}

/**
 * Gemini's responseJsonSchema accepts standard JSON Schema but chokes on a few
 * keywords zod-to-json-schema emits. Strip them recursively, and inline $refs by
 * asking for none up front.
 */
function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  // zod-to-json-schema bundles Zod v3 types; this app is on Zod v4. The runtime
  // conversion works fine — only the compile-time types disagree — so cast via unknown.
  const json = zodToJsonSchema(
    schema as unknown as Parameters<typeof zodToJsonSchema>[0],
    { $refStrategy: "none", target: "openApi3" },
  ) as Record<string, unknown>;

  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        // These make Gemini reject the request or silently ignore the schema.
        if (key === "additionalProperties" || key === "$schema" || key === "default") {
          continue;
        }
        out[key] = strip(value);
      }
      return out;
    }
    return node;
  };

  return strip(json) as Record<string, unknown>;
}

/**
 * One structured call: system + user prompt in, schema-validated object out.
 * Gemini is asked for JSON, then the raw text is re-parsed through the Zod schema —
 * so a malformed model response can never reach the rest of the app.
 */
// The free tier congests in bursts — a 503 on all models one second can clear the
// next. Make several passes through the model chain with growing backoff so a single
// generation survives a transient spike instead of failing on the first bad window.
const MAX_ROUNDS = 3;
const ROUND_BACKOFF_MS = 4_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function generateStructuredGemini<T>(input: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
}): Promise<T> {
  const responseJsonSchema = toGeminiSchema(input.schema);
  let lastError: unknown;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (round > 0) await sleep(ROUND_BACKOFF_MS * round);

    for (const model of MODEL_CHAIN) {
      try {
        const response = await withTimeout(
          gemini().models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: input.user }] }],
            config: {
              systemInstruction: input.system,
              responseMimeType: "application/json",
              responseJsonSchema,
              temperature: 0.8,
            },
          }),
          REQUEST_TIMEOUT_MS,
        );

        const text = response.text;
        if (!text) throw new Error("Gemini returned an empty response.");

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error("Gemini returned invalid JSON.");
        }

        const result = input.schema.safeParse(parsed);
        if (!result.success) {
          const detail = result.error.issues
            .slice(0, 4)
            .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("; ");
          const keys =
            parsed && typeof parsed === "object"
              ? Object.keys(parsed).join(",")
              : typeof parsed;
          // Bad shape from one model can genuinely improve on another (they format
          // differently), so treat it as retryable across the chain.
          throw new Error(`SHAPE_MISMATCH [got keys: ${keys}] ${detail}`);
        }

        return result.data;
      } catch (error) {
        lastError = error;
        // Only keep going for transient/availability/shape errors; an auth or
        // bad-request error won't improve on another model or another round.
        if (!shouldTryNextModel(error)) throw error;
      }
    }
  }

  throw new Error(
    `Every free Gemini model is busy right now (Google-side overload). Try again in a minute. Last error: ${
      lastError instanceof Error ? lastError.message.slice(0, 120) : "unknown"
    }`,
  );
}
