import { generationRoute } from "../_handler";
import { creativesStepSchema } from "@/lib/validations/generate";
import { generateCreatives } from "@/server/generate";

// Ten images plus a video render is the slowest step by far.
export const maxDuration = 300;

export const POST = generationRoute(creativesStepSchema, (input, member) =>
  generateCreatives(member, input.jobId, {
    imagePrompts: input.imagePrompts,
    headline: input.headline,
  }),
);
