import "server-only";

import { MetaApiError } from "@/lib/meta/client";
import { setAdSetBudget, setEntityStatus } from "@/lib/meta/campaigns";
import { getInsights } from "@/lib/meta/insights";
import { decide, type AdSetStat, type Decision } from "@/lib/optimize/rules";
import { db } from "@/lib/db";
import { PLAN_SPECS, planOf } from "@/lib/billing/plans";
import { connectionForClient } from "./meta";
import { regenerateCreative } from "./regenerate";

/**
 * The optimisation loop, in three separable parts:
 *
 *   1. `syncClientMetrics`  — pull yesterday's numbers from Meta into our tables.
 *   2. `optimiseClient`     — read those tables, decide, and act (or queue).
 *   3. `approve` / `revert` — the human overrides.
 *
 * The rules never read Meta directly. They read our snapshots, so any action can be
 * traced back to the exact numbers that produced it.
 */

/** Yesterday, because today's numbers are partial and would trigger on noise. */
function yesterday(): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export async function syncClientMetrics(clientId: string) {
  const client = await db.client.findUnique({
    where: { id: clientId },
    include: {
      owner: true,
      campaigns: {
        where: { metaCampaignId: { not: null } },
        include: { adSets: { include: { ads: true } } },
      },
    },
  });
  if (!client) return { synced: 0 };

  const meta = await connectionForClient(client.id);
  const date = yesterday();
  let synced = 0;

  for (const campaign of client.campaigns) {
    const campaignInsights = await getInsights(
      meta.accessToken,
      campaign.metaCampaignId!,
      "yesterday",
    );

    await db.metric.upsert({
      where: { campaignId_date: { campaignId: campaign.id, date } },
      update: {
        spend: campaignInsights.spend,
        impressions: campaignInsights.impressions,
        clicks: campaignInsights.clicks,
        ctr: campaignInsights.ctr,
        cpc: campaignInsights.cpc,
        cpl: campaignInsights.cpl,
      },
      create: {
        campaignId: campaign.id,
        date,
        spend: campaignInsights.spend,
        impressions: campaignInsights.impressions,
        clicks: campaignInsights.clicks,
        ctr: campaignInsights.ctr,
        cpc: campaignInsights.cpc,
        cpl: campaignInsights.cpl,
      },
    });

    for (const adSet of campaign.adSets) {
      for (const ad of adSet.ads) {
        if (!ad.metaAdId) continue;

        const adInsights = await getInsights(meta.accessToken, ad.metaAdId, "yesterday");

        await db.adMetric.upsert({
          where: { adId_date: { adId: ad.id, date } },
          update: {
            spend: adInsights.spend,
            impressions: adInsights.impressions,
            clicks: adInsights.clicks,
            ctr: adInsights.ctr,
            cpc: adInsights.cpc,
            leads: adInsights.leads,
            cpl: adInsights.cpl,
          },
          create: {
            adId: ad.id,
            date,
            spend: adInsights.spend,
            impressions: adInsights.impressions,
            clicks: adInsights.clicks,
            ctr: adInsights.ctr,
            cpc: adInsights.cpc,
            leads: adInsights.leads,
            cpl: adInsights.cpl,
          },
        });
        synced++;
      }
    }
  }

  return { synced };
}

export async function optimiseClient(clientId: string) {
  const client = await db.client.findUnique({
    where: { id: clientId },
    include: {
      agency: { include: { subscription: true } },
      campaigns: {
        where: { status: "ACTIVE" },
        include: { adSets: { include: { ads: { include: { metrics: true } } } } },
      },
    },
  });

  if (!client) return { decisions: 0, skipped: "not_found" as const };

  // The master switch. With autopilot off we do nothing at all — not even queue.
  if (!client.autopilot) return { decisions: 0, skipped: "autopilot_off" as const };

  // Auto-pilot is a paid capability. A lapsed subscription has to actually stop the
  // optimiser touching Meta — not merely hide the toggle in the UI.
  if (!PLAN_SPECS[planOf(client.agency.subscription)].autopilot) {
    return { decisions: 0, skipped: "plan" as const };
  }

  const date = yesterday();

  const stats: AdSetStat[] = client.campaigns.flatMap((campaign) =>
    campaign.adSets.map((adSet) => ({
      adSetId: adSet.id,
      name: adSet.name,
      dailyBudget: adSet.dailyBudget,
      ads: adSet.ads.map((ad) => {
        const metric = ad.metrics.find(
          (row) => row.date.getTime() === date.getTime(),
        );
        return {
          adId: ad.id,
          name: ad.name,
          status: ad.status,
          impressions: metric?.impressions ?? 0,
          clicks: metric?.clicks ?? 0,
          ctr: metric?.ctr ?? 0,
          spend: metric?.spend ?? 0,
          leads: metric?.leads ?? 0,
          cpl: metric?.cpl ?? null,
        };
      }),
    })),
  );

  const decisions = decide({ adSets: stats, maxDailyBudget: client.maxDailyBudget });

  for (const decision of decisions) {
    await record(client.id, decision, client.requireApproval);
  }

  return { decisions: decisions.length, skipped: null };
}

/**
 * Writes the log first, then acts. If the Meta call fails the row survives as FAILED,
 * so nothing the platform did (or tried to do) is ever invisible.
 */
async function record(clientId: string, decision: Decision, requireApproval: boolean) {
  const log = await db.optimizationLog.create({
    data: {
      clientId,
      action: decision.action,
      reason: decision.reason,
      adId: "adId" in decision ? decision.adId : null,
      adSetId: "adSetId" in decision ? decision.adSetId : null,
      previous: "from" in decision ? { dailyBudget: decision.from } : undefined,
      next: "to" in decision ? { dailyBudget: decision.to } : undefined,
      status: requireApproval ? "PENDING" : "APPLIED",
    },
  });

  if (requireApproval) return log;

  try {
    await apply(decision);
  } catch (error) {
    await db.optimizationLog.update({
      where: { id: log.id },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
  return log;
}

/** The only place that actually mutates Meta on the optimiser's behalf. */
async function apply(decision: Decision) {
  switch (decision.action) {
    case "PAUSE_AD": {
      const ad = await db.ad.findUnique({
        where: { id: decision.adId },
        include: { adSet: { include: { campaign: { include: { client: true } } } } },
      });
      if (!ad?.metaAdId) throw new MetaApiError("Ad not found.");

      const meta = await connectionForClient(ad.adSet.campaign.clientId);
      await setEntityStatus(meta.accessToken, ad.metaAdId, "PAUSED");

      await db.ad.update({
        where: { id: ad.id },
        data: { status: "PAUSED", pausedReason: decision.reason },
      });
      return;
    }

    case "RAISE_BUDGET":
    case "LOWER_BUDGET": {
      const adSet = await db.adSet.findUnique({
        where: { id: decision.adSetId },
        include: { campaign: { include: { client: true } } },
      });
      if (!adSet?.metaAdSetId) throw new MetaApiError("Ad set not found.");

      const meta = await connectionForClient(adSet.campaign.clientId);
      await setAdSetBudget(meta.accessToken, adSet.metaAdSetId, decision.to);

      await db.adSet.update({
        where: { id: adSet.id },
        data: { dailyBudget: decision.to },
      });
      return;
    }

    case "QUEUE_CREATIVE": {
      await regenerateCreative(decision.adSetId);
      return;
    }
  }
}

/** Turns a PENDING decision into a real one. Called from the timeline UI. */
export async function approve(agencyId: string, logId: string) {
  const log = await db.optimizationLog.findFirst({
    where: { id: logId, client: { agencyId } },
  });
  if (!log) throw new MetaApiError("Action not found.");
  if (log.status !== "PENDING") throw new MetaApiError(`That action is already ${log.status}.`);

  const decision = toDecision(log);
  if (!decision) throw new MetaApiError("That action can no longer be applied.");

  try {
    await apply(decision);
    await db.optimizationLog.update({
      where: { id: log.id },
      data: { status: "APPLIED" },
    });
  } catch (error) {
    await db.optimizationLog.update({
      where: { id: log.id },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });
    throw error;
  }
}

export async function reject(agencyId: string, logId: string) {
  const log = await db.optimizationLog.findFirst({
    where: { id: logId, client: { agencyId } },
  });
  if (!log) throw new MetaApiError("Action not found.");
  if (log.status !== "PENDING") throw new MetaApiError(`That action is already ${log.status}.`);

  await db.optimizationLog.update({ where: { id: log.id }, data: { status: "SKIPPED" } });
}

/**
 * Undo. Every applied action stores the state it replaced, which is the whole reason
 * `previous` exists on the log.
 */
export async function revert(agencyId: string, logId: string) {
  const log = await db.optimizationLog.findFirst({
    where: { id: logId, client: { agencyId } },
  });
  if (!log) throw new MetaApiError("Action not found.");
  if (log.status !== "APPLIED") throw new MetaApiError("Only applied actions can be reverted.");

  switch (log.action) {
    case "PAUSE_AD": {
      if (!log.adId) throw new MetaApiError("This action has no ad to restore.");

      const ad = await db.ad.findUnique({
        where: { id: log.adId },
        include: { adSet: { include: { campaign: { include: { client: true } } } } },
      });
      if (!ad?.metaAdId) throw new MetaApiError("Ad not found.");

      const meta = await connectionForClient(ad.adSet.campaign.clientId);
      await setEntityStatus(meta.accessToken, ad.metaAdId, "ACTIVE");
      await db.ad.update({
        where: { id: ad.id },
        data: { status: "ACTIVE", pausedReason: null },
      });
      break;
    }

    case "RAISE_BUDGET":
    case "LOWER_BUDGET": {
      const previous = log.previous as { dailyBudget?: number } | null;
      if (!log.adSetId || typeof previous?.dailyBudget !== "number") {
        throw new MetaApiError("This action didn't record a budget to restore.");
      }

      const adSet = await db.adSet.findUnique({
        where: { id: log.adSetId },
        include: { campaign: { include: { client: true } } },
      });
      if (!adSet?.metaAdSetId) throw new MetaApiError("Ad set not found.");

      const meta = await connectionForClient(adSet.campaign.clientId);
      await setAdSetBudget(meta.accessToken, adSet.metaAdSetId, previous.dailyBudget);
      await db.adSet.update({
        where: { id: adSet.id },
        data: { dailyBudget: previous.dailyBudget },
      });
      break;
    }

    default:
      // A generated creative isn't unmade by deleting a row — pause the ad instead.
      throw new MetaApiError(`${log.action} can't be reverted automatically.`);
  }

  await db.optimizationLog.update({ where: { id: log.id }, data: { status: "REVERTED" } });
}

function toDecision(log: {
  action: string;
  reason: string;
  adId: string | null;
  adSetId: string | null;
  next: unknown;
  previous: unknown;
}): Decision | null {
  const next = log.next as { dailyBudget?: number } | null;
  const previous = log.previous as { dailyBudget?: number } | null;

  switch (log.action) {
    case "PAUSE_AD":
      return log.adId
        ? { action: "PAUSE_AD", adId: log.adId, reason: log.reason }
        : null;

    case "QUEUE_CREATIVE":
      return log.adSetId
        ? { action: "QUEUE_CREATIVE", adSetId: log.adSetId, reason: log.reason }
        : null;

    case "RAISE_BUDGET":
    case "LOWER_BUDGET":
      return log.adSetId &&
        typeof next?.dailyBudget === "number" &&
        typeof previous?.dailyBudget === "number"
        ? {
            action: log.action,
            adSetId: log.adSetId,
            from: previous.dailyBudget,
            to: next.dailyBudget,
            reason: log.reason,
          }
        : null;

    default:
      return null;
  }
}
