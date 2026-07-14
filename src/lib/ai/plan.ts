import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { anthropic, COPY_MODEL, isAnthropicConfigured } from "./anthropic";
import { mockPlan } from "./mock";
import {
  campaignPlanSchema,
  GOAL_LABELS,
  GOAL_TO_META_OBJECTIVE,
  type CampaignPlan,
  type Goal,
  type WebsiteAnalysis,
} from "./schemas";
import { formatRupees } from "@/lib/money";

export type PlanResult = { plan: CampaignPlan; mocked: boolean };

const SYSTEM = `You are a Meta Ads media buyer planning a campaign.

Rules:
- Budget allocations must sum to exactly 100.
- Meta enforces a minimum daily spend per ad set. Do not propose so many ad sets
  that any one of them falls below roughly Rs 100/day — two or three is usually right
  for a small budget.
- Only narrow age or gender when the product genuinely demands it. Over-narrow
  targeting starves Meta's delivery algorithm on small budgets.
- The objective must match the stated campaign goal.`;

/** Audience, budget split, and campaign structure — one call, since they constrain each other. */
export async function generatePlan(
  analysis: WebsiteAnalysis,
  goal: Goal,
  dailyBudgetPaise: number,
): Promise<PlanResult> {
  if (!isAnthropicConfigured) {
    return { plan: mockPlan(analysis, goal), mocked: true };
  }

  const response = await anthropic().messages.parse({
    model: COPY_MODEL,
    max_tokens: 6144,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(campaignPlanSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Campaign goal: ${GOAL_LABELS[goal]}
Required Meta objective: ${GOAL_TO_META_OBJECTIVE[goal]}
Daily budget: ${formatRupees(dailyBudgetPaise)}

Business brief:
${JSON.stringify(analysis, null, 2)}

Plan the audience, the budget split, and the campaign structure.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to plan that campaign.");
  }
  if (!response.parsed_output) {
    throw new Error("Claude returned an unusable plan. Try again.");
  }

  return { plan: normalise(response.parsed_output, goal), mocked: false };
}

/**
 * Guard the two things a wrong answer would break downstream: an objective that
 * contradicts the user's goal, and allocations that don't sum to 100 (which would
 * under- or over-spend the daily budget once Phase 2 publishes it).
 */
function normalise(plan: CampaignPlan, goal: Goal): CampaignPlan {
  const objective = GOAL_TO_META_OBJECTIVE[goal] as CampaignPlan["structure"]["objective"];

  const total = plan.budget.allocations.reduce((sum, a) => sum + a.percentage, 0);
  const allocations =
    total === 100 || total === 0
      ? plan.budget.allocations
      : plan.budget.allocations.map((a) => ({
          ...a,
          percentage: Math.round((a.percentage / total) * 100),
        }));

  return {
    ...plan,
    budget: { allocations },
    structure: { ...plan.structure, objective },
  };
}
