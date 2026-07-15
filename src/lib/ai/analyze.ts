import { generateStructured, isAiConfigured } from "./llm";
import { mockAnalysis } from "./mock";
import { fetchSiteText } from "./scrape";
import { websiteAnalysisSchema, type WebsiteAnalysis } from "./schemas";

export type AnalysisResult = {
  url: string;
  analysis: WebsiteAnalysis;
  /** True when no AI provider is configured and this is placeholder data. */
  mocked: boolean;
};

const SYSTEM = `You are a performance marketing strategist. You are reading the raw
text of a company's website in order to advertise it on Facebook and Instagram.

Report only what the page actually supports. Do not invent services, locations, or
claims the text does not make — a fabricated value proposition becomes a false ad.
If the site never states a location, return "Unknown" rather than guessing.`;

/** Fetches the site, then turns it into a structured brief. */
export async function analyseWebsite(rawUrl: string): Promise<AnalysisResult> {
  const { url, text } = await fetchSiteText(rawUrl);

  if (!isAiConfigured) {
    return { url, analysis: mockAnalysis(url), mocked: true };
  }

  const analysis = await generateStructured({
    system: SYSTEM,
    user: `Website: ${url}\n\nPage text:\n"""\n${text}\n"""\n\nProfile this business.`,
    schema: websiteAnalysisSchema,
    effort: "medium",
    maxTokens: 4096,
  });

  return { url, analysis, mocked: false };
}
