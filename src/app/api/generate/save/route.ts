import { generationRoute } from "../_handler";
import { saveDraftSchema } from "@/lib/validations/generate";
import { saveDraft } from "@/server/generate";

export const POST = generationRoute(saveDraftSchema, (input, member) =>
  saveDraft(member, input.jobId, {
    analysis: input.analysis,
    copy: input.copy,
    plan: input.plan,
    images: input.images,
    videoUrl: input.videoUrl,
  }),
);
