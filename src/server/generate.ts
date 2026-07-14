import "server-only";

import { analyseWebsite } from "@/lib/ai/analyze";
import { generateCopy } from "@/lib/ai/copy";
import { generateImages } from "@/lib/ai/image";
import { generatePlan } from "@/lib/ai/plan";
import { generateVideo } from "@/lib/ai/video";
import type { AdCopy, CampaignPlan, Goal, WebsiteAnalysis } from "@/lib/ai/schemas";
import { db } from "@/lib/db";
import { rupeesToPaise } from "@/lib/money";
import { assertCanAddClient, type Member } from "./tenant";

/**
 * Image and video calls cost real money per request, so generations are capped
 * per agency per day from day one. Raise it with GENERATION_DAILY_LIMIT.
 */
const DAILY_LIMIT = Number(process.env.GENERATION_DAILY_LIMIT ?? 10);

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Every job read is scoped by agency — a job id alone must never grant access. */
async function requireJob(jobId: string, agencyId: string) {
  const job = await db.generationJob.findFirst({
    where: { id: jobId, client: { agencyId } },
    include: { client: true },
  });
  if (!job) throw new GenerationError("Generation not found.", 404);
  return job;
}

async function assertUnderDailyLimit(agencyId: string) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const today = await db.generationJob.count({
    where: { client: { agencyId }, createdAt: { gte: since } },
  });

  if (today >= DAILY_LIMIT) {
    throw new GenerationError(
      `Your agency has hit today's limit of ${DAILY_LIMIT} generations. It resets at midnight.`,
      429,
    );
  }
}

/**
 * Step 1 — read the website and create the job. The job row exists from here on,
 * which is what makes the daily limit countable and the wizard resumable.
 */
export async function startGeneration(
  member: Member,
  input: { url: string; goal: Goal; budgetRupees: number },
) {
  await assertUnderDailyLimit(member.agencyId);

  const { url, analysis, mocked } = await analyseWebsite(input.url);

  const existing = await db.client.findUnique({
    where: { agencyId_websiteUrl: { agencyId: member.agencyId, websiteUrl: url } },
    select: { id: true },
  });

  // Only a *new* client counts against the plan's client limit — re-generating for
  // an existing one must not be blocked by it.
  if (!existing) await assertCanAddClient(member);

  const client = await db.client.upsert({
    where: { agencyId_websiteUrl: { agencyId: member.agencyId, websiteUrl: url } },
    update: { name: analysis.businessName, analysis },
    create: {
      agencyId: member.agencyId,
      ownerId: member.userId,
      websiteUrl: url,
      name: analysis.businessName,
      analysis,
    },
  });

  const job = await db.generationJob.create({
    data: {
      clientId: client.id,
      goal: input.goal,
      budgetPerDay: rupeesToPaise(input.budgetRupees),
      status: "GENERATING",
    },
    select: { id: true },
  });

  return { jobId: job.id, url, analysis, mocked };
}

/** Step 2 — copy and campaign plan. Independent calls, so run them together. */
export async function generateCopyAndPlan(
  member: Member,
  jobId: string,
  analysis: WebsiteAnalysis,
) {
  const job = await requireJob(jobId, member.agencyId);
  const goal = job.goal as Goal;

  const [copyResult, planResult] = await Promise.all([
    generateCopy(analysis, goal),
    generatePlan(analysis, goal, job.budgetPerDay),
  ]);

  await db.generationJob.update({
    where: { id: job.id },
    data: {
      headlines: copyResult.copy.headlines,
      primaryTexts: copyResult.copy.primaryTexts,
      audience: planResult.plan.audience,
      budgetSplit: planResult.plan.budget,
      structure: planResult.plan.structure,
    },
  });

  return {
    copy: copyResult.copy,
    plan: planResult.plan,
    mocked: copyResult.mocked || planResult.mocked,
  };
}

/** Step 3 — images, then an optional video built from them. */
export async function generateCreatives(
  member: Member,
  jobId: string,
  input: { imagePrompts: string[]; headline: string },
) {
  const job = await requireJob(jobId, member.agencyId);

  const { images, mocked, provider } = await generateImages(input.imagePrompts);
  const video = await generateVideo({ headline: input.headline, imageUrls: images });

  await db.generationJob.update({
    where: { id: job.id },
    data: { images, videos: video.url ? [video.url] : [] },
  });

  return { images, mocked, provider, video };
}

/** Step 4 — persist the user's edited version and mark it a DRAFT. */
export async function saveDraft(
  member: Member,
  jobId: string,
  input: {
    analysis: WebsiteAnalysis;
    copy: AdCopy;
    plan: CampaignPlan;
    images: string[];
    videoUrl: string | null;
  },
) {
  const job = await requireJob(jobId, member.agencyId);

  await db.$transaction([
    db.client.update({
      where: { id: job.clientId },
      data: { analysis: input.analysis, name: input.analysis.businessName },
    }),
    db.generationJob.update({
      where: { id: job.id },
      data: {
        headlines: input.copy.headlines,
        primaryTexts: input.copy.primaryTexts,
        audience: input.plan.audience,
        budgetSplit: input.plan.budget,
        structure: input.plan.structure,
        images: input.images,
        videos: input.videoUrl ? [input.videoUrl] : [],
        status: "DRAFT",
      },
    }),
  ]);

  return { jobId: job.id, clientId: job.clientId };
}
