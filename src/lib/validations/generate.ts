import { z } from "zod";

import { MAX_DAILY_BUDGET_RUPEES, MIN_DAILY_BUDGET_RUPEES } from "@/lib/money";
import {
  adCopySchema,
  campaignPlanSchema,
  GOALS,
  websiteAnalysisSchema,
} from "@/lib/ai/schemas";

export const startGenerationSchema = z.object({
  url: z.string().min(3, "Enter your website address."),
  goal: z.enum(GOALS),
  budgetRupees: z
    .number()
    .int("Enter a whole number of rupees.")
    .min(
      MIN_DAILY_BUDGET_RUPEES,
      `Meta's minimum daily budget is about ₹${MIN_DAILY_BUDGET_RUPEES}.`,
    )
    .max(MAX_DAILY_BUDGET_RUPEES, "That daily budget is implausibly large."),
});
export type StartGenerationInput = z.infer<typeof startGenerationSchema>;

export const jobIdSchema = z.object({ jobId: z.string().min(1) });

/** The wizard sends the analysis back so the user's edits to it are honoured. */
export const copyStepSchema = jobIdSchema.extend({
  analysis: websiteAnalysisSchema,
});

export const creativesStepSchema = jobIdSchema.extend({
  imagePrompts: z.array(z.string()),
  headline: z.string(),
});

/** Review screen — everything is editable, so everything is re-validated on save. */
export const saveDraftSchema = jobIdSchema.extend({
  analysis: websiteAnalysisSchema,
  copy: adCopySchema,
  plan: campaignPlanSchema,
  images: z.array(z.string()),
  videoUrl: z.string().nullable(),
});
