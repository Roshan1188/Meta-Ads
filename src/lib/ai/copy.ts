import { generateStructured, isAiConfigured } from "./llm";
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
  if (!isAiConfigured) {
    return { copy: mockCopy(analysis), mocked: true };
  }

  const copy = await generateStructured({
    system: SYSTEM,
    user: `Campaign goal: ${GOAL_LABELS[goal]}

Business brief:
${JSON.stringify(analysis, null, 2)}

Write the ad copy and image prompts.`,
    schema: adCopySchema,
    effort: "high",
    maxTokens: 8192,
  });

  return { copy: enforceLengths(copy), mocked: false };
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
