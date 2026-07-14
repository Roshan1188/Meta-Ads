import Anthropic from "@anthropic-ai/sdk";

/**
 * Claude is the only text provider, but every call goes through this module so a
 * swap means editing one file. Keep feature code free of SDK types.
 */
export const COPY_MODEL = "claude-opus-4-8";

export const isAnthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | undefined;

/** Lazily constructed — importing this module must not throw when the key is absent. */
export function anthropic(): Anthropic {
  if (!isAnthropicConfigured) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env, or the app falls back to mock output.",
    );
  }
  client ??= new Anthropic();
  return client;
}
