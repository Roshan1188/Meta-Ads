import "server-only";

import { generateCopy } from "@/lib/ai/copy";
import { generateImages } from "@/lib/ai/image";
import { websiteAnalysisSchema, type Goal } from "@/lib/ai/schemas";
import {
  createAd,
  createAdCreative,
  setEntityStatus,
  uploadImage,
} from "@/lib/meta/campaigns";
import { MetaApiError } from "@/lib/meta/client";
import { db } from "@/lib/db";
import { connectionForClient } from "./meta";

/**
 * When the optimiser pauses an ad for low CTR, the ad set is left thinner. This
 * builds a replacement from fresh AI copy and a fresh image, reusing the Phase 1
 * generators and the Phase 2 publisher rather than duplicating either.
 *
 * The replacement goes live only if its campaign is already live — a paused campaign
 * gets a paused replacement. We never resurrect delivery the user had stopped.
 */
export async function regenerateCreative(adSetId: string) {
  const adSet = await db.adSet.findUnique({
    where: { id: adSetId },
    include: {
      ads: true,
      campaign: { include: { client: true } },
    },
  });

  if (!adSet?.metaAdSetId) throw new MetaApiError("Ad set not found.");

  const client = adSet.campaign.client;

  const analysis = websiteAnalysisSchema.safeParse(client.analysis);
  if (!analysis.success) {
    throw new MetaApiError(
      "This client has no usable website analysis, so a replacement creative can't be written.",
    );
  }

  const goal = goalFromObjective(adSet.campaign.objective);
  const meta = await connectionForClient(client.id);

  const { copy, mocked: copyMocked } = await generateCopy(analysis.data, goal);

  // Avoid handing Meta the same headline it just under-performed with.
  const used = new Set(
    adSet.ads.map((ad) => (ad.copy as { headline?: string } | null)?.headline),
  );
  const headline = copy.headlines.find((option) => !used.has(option)) ?? copy.headlines[0];
  const primaryText = copy.primaryTexts[0];

  const { images, mocked: imagesMocked } = await generateImages([copy.imagePrompts[0]]);

  // A mock creative on a live campaign would spend real money on a placeholder.
  if (copyMocked || imagesMocked || images[0]?.startsWith("data:")) {
    throw new MetaApiError(
      "Creative regeneration needs ANTHROPIC_API_KEY and REPLICATE_API_TOKEN — refusing to publish placeholder creative to a live ad set.",
    );
  }

  const imageHash = await uploadImage(meta.accessToken, meta.adAccountId, images[0]);
  const name = `${adSet.name} — Auto ${adSet.ads.length + 1}`;

  const creativeId = await createAdCreative(meta.accessToken, meta.adAccountId, {
    name,
    pageId: meta.pageId,
    instagramActorId: meta.igAccountId,
    imageHash,
    headline,
    primaryText,
    linkUrl: client.websiteUrl,
  });

  const metaAdId = await createAd(meta.accessToken, meta.adAccountId, {
    name,
    adSetId: adSet.metaAdSetId,
    creativeId,
  });

  const status = adSet.campaign.status === "ACTIVE" ? "ACTIVE" : "PAUSED";

  // createAd always creates PAUSED (the Phase 2 guardrail). Promote only when the
  // campaign it belongs to is already spending.
  if (status === "ACTIVE") {
    await setEntityStatus(meta.accessToken, metaAdId, "ACTIVE");
  }

  return db.ad.create({
    data: {
      adSetId: adSet.id,
      metaAdId,
      metaCreativeId: creativeId,
      name,
      creativeUrl: images[0],
      copy: { headline, primaryText },
      status,
    },
  });
}

function goalFromObjective(objective: string): Goal {
  switch (objective) {
    case "OUTCOME_LEADS":
      return "LEAD_GEN";
    case "OUTCOME_AWARENESS":
      return "AWARENESS";
    default:
      return "TRAFFIC";
  }
}
