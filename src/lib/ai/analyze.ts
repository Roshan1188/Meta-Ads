import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { anthropic, COPY_MODEL, isAnthropicConfigured } from "./anthropic";
import { mockAnalysis } from "./mock";
import { fetchSiteText } from "./scrape";
import { websiteAnalysisSchema, type WebsiteAnalysis } from "./schemas";

export type AnalysisResult = {
  url: string;
  analysis: WebsiteAnalysis;
  /** True when ANTHROPIC_API_KEY is absent and this is placeholder data. */
  mocked: boolean;
};

const SYSTEM = `You are a performance marketing strategist. You are reading the raw
text of a company's website in order to advertise it on Facebook and Instagram.

Report only what the page actually supports. Do not invent services, locations, or
claims the text does not make — a fabricated value proposition becomes a false ad.
If the site never states a location, return "Unknown" rather than guessing.`;

/** Fetches the site, then has Claude turn it into a structured brief. */
export async function analyseWebsite(rawUrl: string): Promise<AnalysisResult> {
  const { url, text } = await fetchSiteText(rawUrl);

  if (!isAnthropicConfigured) {
    return { url, analysis: mockAnalysis(url), mocked: true };
  }

  const response = await anthropic().messages.parse({
    model: COPY_MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: zodOutputFormat(websiteAnalysisSchema),
    },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Website: ${url}\n\nPage text:\n"""\n${text}\n"""\n\nProfile this business.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to analyse that website.");
  }
  if (!response.parsed_output) {
    throw new Error("Claude returned an unusable analysis. Try again.");
  }

  return { url, analysis: response.parsed_output, mocked: false };
}
