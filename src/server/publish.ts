import "server-only";

import { MetaApiError } from "@/lib/meta/client";
import {
  createAd,
  createAdCreative,
  createAdSet,
  createCampaign,
  OBJECTIVES,
  setEntityStatus,
  uploadImage,
} from "@/lib/meta/campaigns";
import { buildTargeting } from "@/lib/meta/targeting";
import {
  adCopySchema,
  audienceSchema,
  budgetSplitSchema,
  campaignStructureSchema,
  type Goal,
} from "@/lib/ai/schemas";
import { db } from "@/lib/db";
import { MIN_DAILY_BUDGET_RUPEES, formatRupees } from "@/lib/money";
import { connectionForClient } from "./meta";
import { assertCanAddCampaign, type Member } from "./tenant";

/** One line in the live publish log. */
export type PublishEvent =
  | { type: "step"; key: string; label: string; status: "running" | "done" }
  | { type: "warn"; message: string }
  | { type: "error"; message: string }
  | { type: "done"; campaignId: string; metaCampaignId: string; adCount: number };

const MIN_ADSET_BUDGET_MINOR = MIN_DAILY_BUDGET_RUPEES * 100;

/**
 * Publishes a DRAFT GenerationJob to Meta, yielding a step at a time so the UI can
 * show progress rather than a two-minute spinner.
 *
 * Everything is created PAUSED. Nothing here can start spending money — activation
 * is a separate, explicit action.
 */
export async function* publishDraft(
  member: Member,
  jobId: string,
): AsyncGenerator<PublishEvent> {
  const job = await db.generationJob.findFirst({
    where: { id: jobId, client: { agencyId: member.agencyId } },
    include: { client: true },
  });

  if (!job) {
    yield { type: "error", message: "Draft not found." };
    return;
  }
  if (job.status !== "DRAFT") {
    yield { type: "error", message: `This draft is ${job.status}, not DRAFT.` };
    return;
  }

  try {
    yield { type: "step", key: "connect", label: "Checking your Meta connection", status: "running" };
    await assertCanAddCampaign(member);
    const meta = await connectionForClient(job.clientId);

    // Remember whose token published this, so the nightly optimiser has a credential
    // to act with when nobody is logged in.
    await db.client.update({
      where: { id: job.clientId },
      data: { metaAuthUserId: job.client.metaAuthUserId ?? member.userId },
    });
    yield { type: "step", key: "connect", label: "Checking your Meta connection", status: "done" };

    // The job's Json columns are unvalidated at the DB level, so re-parse them —
    // a draft could have been written by an older version of the app.
    const copy = adCopySchema.parse(hydrate(job));
    const audience = audienceSchema.parse(job.audience);
    const budget = budgetSplitSchema.parse(job.budgetSplit);
    const structure = campaignStructureSchema.parse(job.structure);
    const images = (job.images as string[] | null) ?? [];
    const goal = job.goal as Goal;

    if (images.length === 0) {
      throw new MetaApiError("This draft has no images. Regenerate it before publishing.");
    }
    // A data: URI is a mock image — Meta would take the bytes and run a nonsense ad.
    if (images.some((url) => url.startsWith("data:"))) {
      throw new MetaApiError(
        "This draft contains placeholder images. Set REPLICATE_API_TOKEN and regenerate before publishing.",
      );
    }

    const allocations = splitBudget(job.budgetPerDay, budget.allocations);

    yield { type: "step", key: "targeting", label: "Resolving audience with Meta", status: "running" };
    const { spec, droppedInterests } = await buildTargeting(meta.accessToken, audience, {
      includeInstagram: Boolean(meta.igAccountId),
    });
    yield { type: "step", key: "targeting", label: "Resolving audience with Meta", status: "done" };

    if (droppedInterests.length > 0) {
      yield {
        type: "warn",
        message: `Meta had no match for these interests, so they were left out: ${droppedInterests.join(", ")}.`,
      };
    }

    yield { type: "step", key: "campaign", label: "Creating the campaign", status: "running" };
    const metaCampaignId = await createCampaign(meta.accessToken, meta.adAccountId, {
      name: structure.campaignName,
      objective: OBJECTIVES[goal],
    });

    const campaign = await db.campaign.create({
      data: {
        clientId: job.clientId,
        generationJobId: job.id,
        metaCampaignId,
        name: structure.campaignName,
        objective: OBJECTIVES[goal],
        status: "PAUSED",
        dailyBudget: job.budgetPerDay,
      },
    });
    yield { type: "step", key: "campaign", label: "Creating the campaign", status: "done" };

    yield { type: "step", key: "images", label: `Uploading ${images.length} images`, status: "running" };
    const imageHashes = await Promise.all(
      images.map((url) => uploadImage(meta.accessToken, meta.adAccountId, url)),
    );
    yield { type: "step", key: "images", label: `Uploading ${images.length} images`, status: "done" };

    let adCount = 0;

    for (const [index, allocation] of allocations.entries()) {
      const plannedAdSet = structure.adSets[index];
      const label = `Building ad set "${allocation.adSetName}"`;

      yield { type: "step", key: `adset-${index}`, label, status: "running" };

      const metaAdSetId = await createAdSet(meta.accessToken, meta.adAccountId, {
        name: allocation.adSetName,
        campaignId: metaCampaignId,
        dailyBudgetMinor: allocation.budgetMinor,
        goal,
        pixelId: meta.pixelId,
        targeting: spec,
      });

      const adSet = await db.adSet.create({
        data: {
          campaignId: campaign.id,
          metaAdSetId,
          name: allocation.adSetName,
          dailyBudget: allocation.budgetMinor,
          status: "PAUSED",
          audience,
        },
      });

      // Each ad pairs a distinct headline and image so Phase 3 has real variants to
      // test against each other, rather than the same creative N times.
      const adsWanted = Math.max(1, Math.min(plannedAdSet?.adCount ?? 3, images.length));

      for (let slot = 0; slot < adsWanted; slot++) {
        const cursor = index * adsWanted + slot;
        const headline = copy.headlines[cursor % copy.headlines.length];
        const primaryText = copy.primaryTexts[cursor % copy.primaryTexts.length];
        const imageHash = imageHashes[cursor % imageHashes.length];
        const name = `${allocation.adSetName} — Ad ${slot + 1}`;

        const creativeId = await createAdCreative(meta.accessToken, meta.adAccountId, {
          name,
          pageId: meta.pageId,
          instagramActorId: meta.igAccountId,
          imageHash,
          headline,
          primaryText,
          linkUrl: job.client.websiteUrl,
        });

        const metaAdId = await createAd(meta.accessToken, meta.adAccountId, {
          name,
          adSetId: metaAdSetId,
          creativeId,
        });

        await db.ad.create({
          data: {
            adSetId: adSet.id,
            metaAdId,
            metaCreativeId: creativeId,
            name,
            creativeUrl: images[cursor % images.length],
            copy: { headline, primaryText },
            status: "PAUSED",
          },
        });
        adCount++;
      }

      yield { type: "step", key: `adset-${index}`, label, status: "done" };
    }

    await db.generationJob.update({
      where: { id: job.id },
      data: { status: "PUBLISHED" },
    });

    yield { type: "done", campaignId: campaign.id, metaCampaignId, adCount };
  } catch (error) {
    yield {
      type: "error",
      message:
        error instanceof Error ? error.message : "Publishing failed for an unknown reason.",
    };
  }
}

function hydrate(job: { headlines: unknown; primaryTexts: unknown }) {
  return {
    headlines: job.headlines,
    primaryTexts: job.primaryTexts,
    // Image prompts aren't persisted — the images already exist by publish time.
    imagePrompts: [],
  };
}

type Allocation = { adSetName: string; budgetMinor: number };

/**
 * Turns percentages into real money. Meta rejects an ad set below its minimum daily
 * budget, so catch that here with a message the user can act on rather than letting
 * Meta return "Invalid parameter".
 */
function splitBudget(
  totalMinor: number,
  allocations: { adSetName: string; percentage: number }[],
): Allocation[] {
  if (allocations.length === 0) {
    return [{ adSetName: "Default", budgetMinor: totalMinor }];
  }

  const split = allocations.map((allocation) => ({
    adSetName: allocation.adSetName,
    budgetMinor: Math.floor((totalMinor * allocation.percentage) / 100),
  }));

  const starved = split.find((entry) => entry.budgetMinor < MIN_ADSET_BUDGET_MINOR);
  if (starved) {
    throw new MetaApiError(
      `"${starved.adSetName}" would get ${formatRupees(starved.budgetMinor)}/day, below Meta's ` +
        `minimum of about ${formatRupees(MIN_ADSET_BUDGET_MINOR)} per ad set. Raise the daily budget ` +
        `or use fewer ad sets.`,
    );
  }

  return split;
}

/**
 * Activation is the only path that can start spending. Kept separate on purpose.
 *
 * `agencyId` (not a member) so the scheduler can call it with no logged-in user;
 * the permission check for human callers happens at the route.
 */
export async function setCampaignStatus(
  agencyId: string,
  campaignId: string,
  status: "ACTIVE" | "PAUSED",
  confirmDailyBudget?: number,
) {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, client: { agencyId } },
    include: { adSets: { include: { ads: true } } },
  });

  if (!campaign?.metaCampaignId) throw new MetaApiError("Campaign not found.");

  // The budget the user confirmed must be the budget that's about to run. If they
  // disagree the page was stale, and going live anyway could spend the wrong amount.
  if (status === "ACTIVE" && confirmDailyBudget !== campaign.dailyBudget) {
    throw new MetaApiError(
      `This campaign's daily budget is ${formatRupees(campaign.dailyBudget)}, not what your ` +
        `screen showed. Reload the page and confirm again.`,
    );
  }

  const meta = await connectionForClient(campaign.clientId);

  // Meta gates delivery at every level, so a campaign flipped ACTIVE while its ad
  // sets stay PAUSED simply never spends — and looks broken.
  for (const adSet of campaign.adSets) {
    for (const ad of adSet.ads) {
      if (ad.metaAdId) await setEntityStatus(meta.accessToken, ad.metaAdId, status);
    }
    if (adSet.metaAdSetId) await setEntityStatus(meta.accessToken, adSet.metaAdSetId, status);
  }
  await setEntityStatus(meta.accessToken, campaign.metaCampaignId, status);

  await db.$transaction([
    db.campaign.update({ where: { id: campaign.id }, data: { status } }),
    db.adSet.updateMany({ where: { campaignId: campaign.id }, data: { status } }),
    db.ad.updateMany({
      where: { adSet: { campaignId: campaign.id } },
      data: { status },
    }),
  ]);

  return { status };
}
