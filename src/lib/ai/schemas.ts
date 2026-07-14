import { z } from "zod";

/**
 * Every AI response is constrained to one of these schemas via structured
 * outputs, then parsed again here. The model cannot hand us a shape the rest of
 * the app doesn't expect.
 *
 * Note: structured outputs reject `.min()`/`.max()` on strings and arrays, so
 * length rules live in the prompt and are checked after parsing where they matter
 * (see MAX_HEADLINE_CHARS).
 */

/** Meta truncates headlines past roughly this length in most placements. */
export const MAX_HEADLINE_CHARS = 40;

export const GOALS = ["LEAD_GEN", "TRAFFIC", "AWARENESS"] as const;
export type Goal = (typeof GOALS)[number];

export const GOAL_LABELS: Record<Goal, string> = {
  LEAD_GEN: "Lead generation",
  TRAFFIC: "Traffic",
  AWARENESS: "Awareness",
};

/** Maps to a Meta campaign objective in Phase 2. */
export const GOAL_TO_META_OBJECTIVE: Record<Goal, string> = {
  LEAD_GEN: "OUTCOME_LEADS",
  TRAFFIC: "OUTCOME_TRAFFIC",
  AWARENESS: "OUTCOME_AWARENESS",
};

export const websiteAnalysisSchema = z.object({
  businessName: z.string().describe("The trading name of the business."),
  summary: z.string().describe("Two sentences on what this business actually does."),
  services: z.array(z.string()).describe("The concrete services or products sold."),
  valueProps: z
    .array(z.string())
    .describe("Reasons a customer would pick them over a competitor."),
  tone: z
    .string()
    .describe("The brand's voice, e.g. 'warm and practical' or 'clinical and precise'."),
  location: z
    .string()
    .describe("Primary city/region served, or 'Unknown' if the site never says."),
  targetCustomer: z.string().describe("Who buys this, in one sentence."),
});
export type WebsiteAnalysis = z.infer<typeof websiteAnalysisSchema>;

export const adCopySchema = z.object({
  headlines: z
    .array(z.string())
    .describe(`Exactly 10 headlines, each at most ${MAX_HEADLINE_CHARS} characters.`),
  primaryTexts: z
    .array(z.string())
    .describe("Exactly 5 primary texts, each 2-4 sentences."),
  imagePrompts: z
    .array(z.string())
    .describe(
      "Exactly 10 text-to-image prompts for on-brand ad creatives. Describe a scene, " +
        "not a poster: no text, no logos, no words rendered in the image.",
    ),
});
export type AdCopy = z.infer<typeof adCopySchema>;

export const audienceSchema = z.object({
  interests: z.array(z.string()).describe("Meta interest targets, by their common name."),
  ageMin: z.number().int().describe("Between 18 and 65."),
  ageMax: z.number().int().describe("Between 18 and 65, and not below ageMin."),
  genders: z
    .enum(["ALL", "MALE", "FEMALE"])
    .describe("Only narrow this when the product is genuinely gender-specific."),
  locations: z.array(z.string()).describe("Cities or regions to target."),
  rationale: z.string().describe("One sentence on why this audience fits."),
});
export type Audience = z.infer<typeof audienceSchema>;

export const budgetSplitSchema = z.object({
  allocations: z
    .array(
      z.object({
        adSetName: z.string(),
        percentage: z.number().int().describe("Whole percent of the daily budget."),
        reason: z.string(),
      }),
    )
    .describe("Splits the daily budget across ad sets. Percentages must sum to 100."),
});
export type BudgetSplit = z.infer<typeof budgetSplitSchema>;

export const campaignStructureSchema = z.object({
  campaignName: z.string(),
  objective: z
    .enum(["OUTCOME_LEADS", "OUTCOME_TRAFFIC", "OUTCOME_AWARENESS"])
    .describe("Must match the user's stated goal."),
  adSets: z.array(
    z.object({
      name: z.string(),
      audienceNote: z.string().describe("How this ad set's audience differs from the others."),
      adCount: z.number().int().describe("How many ad variants to run in this ad set."),
    }),
  ),
});
export type CampaignStructure = z.infer<typeof campaignStructureSchema>;

/** One model call returns all three planning artefacts together — they're interdependent. */
export const campaignPlanSchema = z.object({
  audience: audienceSchema,
  budget: budgetSplitSchema,
  structure: campaignStructureSchema,
});
export type CampaignPlan = z.infer<typeof campaignPlanSchema>;
