import { generationRoute } from "../_handler";
import { startGenerationSchema } from "@/lib/validations/generate";
import { startGeneration } from "@/server/generate";

// Reading a slow site plus a model call can exceed the default serverless budget.
export const maxDuration = 120;

export const POST = generationRoute(startGenerationSchema, (input, member) =>
  startGeneration(member, input),
);
