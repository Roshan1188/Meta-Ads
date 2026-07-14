import { generationRoute } from "../_handler";
import { copyStepSchema } from "@/lib/validations/generate";
import { generateCopyAndPlan } from "@/server/generate";

export const maxDuration = 180;

export const POST = generationRoute(copyStepSchema, (input, member) =>
  generateCopyAndPlan(member, input.jobId, input.analysis),
);
