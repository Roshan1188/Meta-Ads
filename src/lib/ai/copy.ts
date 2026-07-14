import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { anthropic, COPY_MODEL, isAnthropicConfigured } from "./anthropic";
import { mockCopy } from "./mock";
import {
  adCopySchema,
  GOAL_LABELS,
  MAX_HEADLINE_CHARS,
  type AdCopy,
  type Goal,
  type WebsiteAnalysis,
} from "./schemas";

export type CopyResult = { copy: AdCopy; mocked: boolean };

const SYSTEM = `You write Facebook and Instagram ad copy that performs.

Rules:
- Exactly 10 headlines. Each must be ${MAX_HEADLINE_CHARS} characters or fewer — count them.
- Exactly 5 primary texts, 2-4 sentences each.
- Exactly 10 image prompts.
- Vary the angle across headlines: benefit, objection, curiosity, proof, urgency, offer.
- Write in the business's own voice and only make claims their website supports.
- No emoji spam, no ALL CAPS, no "Click here". Meta rejects ads that imply personal
  attributes ("Are you diabetic?") — write about the offer, not the reader's condition.
- Image prompts describe a photographic or illustrated scene. Never ask for text,
  words, logos, or watermarks in the image — image models render them as gibberish.`;

/** Generates headlines, primary texts, and the image prompts used downstream. */
export async function generateCopy(
  analysis: WebsiteAnalysis,
  goal: Goal,
): Promise<CopyResult> {
  if (!isAnthropicConfigured) {
    return { copy: mockCopy(analysis), mocked: true };
  }

  const response = await anthropic().messages.parse({
    model: COPY_MODEL,
    max_tokens: 8192,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(adCopySchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Campaign goal: ${GOAL_LABELS[goal]}

Business brief:
${JSON.stringify(analysis, null, 2)}

Write the ad copy and image prompts.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to write copy for that business.");
  }
  if (!response.parsed_output) {
    throw new Error("Claude returned unusable copy. Try again.");
  }

  return { copy: enforceLengths(response.parsed_output), mocked: false };
}

/**
 * Structured outputs can't enforce string length, and an over-long headline is
 * silently truncated by Meta mid-word. Trim at a word boundary instead.
 */
function enforceLengths(copy: AdCopy): AdCopy {
  return {
    ...copy,
    headlines: copy.headlines.map((headline) => {
      if (headline.length <= MAX_HEADLINE_CHARS) return headline;
      const clipped = headline.slice(0, MAX_HEADLINE_CHARS);
      const lastSpace = clipped.lastIndexOf(" ");
      return (lastSpace > 20 ? clipped.slice(0, lastSpace) : clipped).trimEnd();
    }),
  };
}
