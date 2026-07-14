import "server-only";

import { graphPost, MetaApiError } from "./client";
import type { TargetingSpec } from "./targeting";
import type { Goal } from "@/lib/ai/schemas";

type Created = { id: string };

/**
 * Meta pairs each objective with a legal set of optimisation goals. Getting this
 * wrong is the single most common publish failure, so the mapping is explicit.
 *
 * OUTCOME_LEADS is the awkward one: optimising for leads requires either a Pixel
 * (offsite conversions) or an instant form. We only support the Pixel route, and
 * refuse to publish without one rather than silently downgrading the campaign to
 * link clicks — that would spend the budget on a different goal than the user chose.
 */
export const OBJECTIVES: Record<Goal, string> = {
  LEAD_GEN: "OUTCOME_LEADS",
  TRAFFIC: "OUTCOME_TRAFFIC",
  AWARENESS: "OUTCOME_AWARENESS",
};

type Optimisation = {
  optimization_goal: string;
  billing_event: string;
  promoted_object?: Record<string, string>;
};

export function optimisationFor(goal: Goal, pixelId?: string | null): Optimisation {
  switch (goal) {
    case "TRAFFIC":
      return { optimization_goal: "LINK_CLICKS", billing_event: "IMPRESSIONS" };

    case "AWARENESS":
      return { optimization_goal: "REACH", billing_event: "IMPRESSIONS" };

    case "LEAD_GEN":
      if (!pixelId) {
        throw new MetaApiError(
          "Lead campaigns need a Meta Pixel so Meta can optimise for actual leads. " +
            "Pick a Pixel in Settings → Meta, or generate a Traffic campaign instead.",
        );
      }
      return {
        optimization_goal: "OFFSITE_CONVERSIONS",
        billing_event: "IMPRESSIONS",
        promoted_object: { pixel_id: pixelId, custom_event_type: "LEAD" },
      };
  }
}

export async function createCampaign(
  token: string,
  adAccountId: string,
  input: { name: string; objective: string },
): Promise<string> {
  const res = await graphPost<Created>(`/${adAccountId}/campaigns`, token, {
    name: input.name,
    objective: input.objective,
    // Never create a live campaign. Activation is a separate, explicit user action.
    status: "PAUSED",
    special_ad_categories: [],
  });
  return res.id;
}

export async function createAdSet(
  token: string,
  adAccountId: string,
  input: {
    name: string;
    campaignId: string;
    dailyBudgetMinor: number;
    goal: Goal;
    pixelId?: string | null;
    targeting: TargetingSpec;
  },
): Promise<string> {
  const optimisation = optimisationFor(input.goal, input.pixelId);

  const res = await graphPost<Created>(`/${adAccountId}/adsets`, token, {
    name: input.name,
    campaign_id: input.campaignId,
    // Meta wants the ad account's minor currency unit — paise for an INR account.
    daily_budget: input.dailyBudgetMinor,
    ...optimisation,
    targeting: input.targeting,
    status: "PAUSED",
  });
  return res.id;
}

/**
 * Meta will not fetch a creative from an arbitrary URL — the bytes must be uploaded
 * to the ad account first, which returns a hash used by the creative.
 */
export async function uploadImage(
  token: string,
  adAccountId: string,
  imageUrl: string,
): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new MetaApiError(`Could not download the generated image (HTTP ${res.status}).`);
  }

  const bytes = Buffer.from(await res.arrayBuffer()).toString("base64");

  const uploaded = await graphPost<{
    images: Record<string, { hash: string; url: string }>;
  }>(`/${adAccountId}/adimages`, token, { bytes });

  // The response is keyed by an arbitrary filename, so take the first entry.
  const image = Object.values(uploaded.images)[0];
  if (!image?.hash) throw new MetaApiError("Meta accepted the image but returned no hash.");

  return image.hash;
}

export async function createAdCreative(
  token: string,
  adAccountId: string,
  input: {
    name: string;
    pageId: string;
    instagramActorId?: string | null;
    imageHash: string;
    headline: string;
    primaryText: string;
    linkUrl: string;
  },
): Promise<string> {
  const res = await graphPost<Created>(`/${adAccountId}/adcreatives`, token, {
    name: input.name,
    object_story_spec: {
      page_id: input.pageId,
      ...(input.instagramActorId ? { instagram_actor_id: input.instagramActorId } : {}),
      link_data: {
        link: input.linkUrl,
        message: input.primaryText,
        name: input.headline,
        image_hash: input.imageHash,
        call_to_action: { type: "LEARN_MORE" },
      },
    },
    degrees_of_freedom_spec: {
      // Meta otherwise "improves" the creative by cropping and rewriting it, which
      // silently discards the copy the user just approved.
      creative_features_spec: { standard_enhancements: { enroll_status: "OPT_OUT" } },
    },
  });
  return res.id;
}

export async function createAd(
  token: string,
  adAccountId: string,
  input: { name: string; adSetId: string; creativeId: string },
): Promise<string> {
  const res = await graphPost<Created>(`/${adAccountId}/ads`, token, {
    name: input.name,
    adset_id: input.adSetId,
    creative: { creative_id: input.creativeId },
    status: "PAUSED",
  });
  return res.id;
}

/** Phase 3 — the optimiser's budget lever. Minor currency units, same as creation. */
export async function setAdSetBudget(
  token: string,
  metaAdSetId: string,
  dailyBudgetMinor: number,
): Promise<void> {
  await graphPost(`/${metaAdSetId}`, token, { daily_budget: dailyBudgetMinor });
}

/** Used by the activate/pause guardrail. Meta treats status as an update on the node. */
export async function setEntityStatus(
  token: string,
  entityId: string,
  status: "ACTIVE" | "PAUSED",
): Promise<void> {
  await graphPost(`/${entityId}`, token, { status });
}
