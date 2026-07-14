import "server-only";

import { db } from "@/lib/db";
import { setCampaignStatus } from "./publish";

/**
 * Scheduled start/stop. Runs hourly rather than to the minute: ad delivery ramps over
 * hours anyway, and an hourly job is far cheaper than a per-minute one.
 *
 * `endAt` is treated as a hard stop — it runs even for campaigns the optimiser or a
 * human touched in the meantime.
 */
export async function runSchedule(now = new Date()) {
  const started: string[] = [];
  const stopped: string[] = [];
  const failed: { id: string; error: string }[] = [];

  const due = await db.campaign.findMany({
    where: {
      metaCampaignId: { not: null },
      OR: [
        { status: "PAUSED", startAt: { lte: now } },
        { status: "ACTIVE", endAt: { lte: now } },
      ],
    },
    include: { client: { select: { agencyId: true } } },
  });

  for (const campaign of due) {
    // A campaign whose window has already closed must never be started, even if its
    // startAt is also in the past — otherwise a late run would revive a finished one.
    const expired = campaign.endAt !== null && campaign.endAt <= now;
    const target = expired ? "PAUSED" : "ACTIVE";

    if (campaign.status === target) continue;

    try {
      await setCampaignStatus(
        campaign.client.agencyId,
        campaign.id,
        target,
        // The scheduler is the confirmation — the user set the window deliberately.
        target === "ACTIVE" ? campaign.dailyBudget : undefined,
      );
      (target === "ACTIVE" ? started : stopped).push(campaign.id);
    } catch (error) {
      failed.push({
        id: campaign.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return { started: started.length, stopped: stopped.length, failed };
}

/** Anomalies worth waking someone for. */
export type Anomaly = {
  clientId: string;
  clientName: string;
  kind: "SPEND_SPIKE" | "CPL_JUMP";
  message: string;
};

const SPIKE_MULTIPLE = 2;
const CPL_JUMP_MULTIPLE = 1.5;

/**
 * Compares yesterday against the preceding week's average. A spend spike or a CPL
 * jump usually means something broke — a runaway ad set, or a landing page that
 * stopped converting.
 */
export async function detectAnomalies(agencyId: string): Promise<Anomaly[]> {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setUTCDate(dayStart.getUTCDate() - 1);
  dayStart.setUTCHours(0, 0, 0, 0);

  const baselineStart = new Date(dayStart);
  baselineStart.setUTCDate(baselineStart.getUTCDate() - 7);

  const clients = await db.client.findMany({
    where: { agencyId },
    include: {
      campaigns: {
        include: { metrics: { where: { date: { gte: baselineStart } } } },
      },
    },
  });

  const anomalies: Anomaly[] = [];

  for (const client of clients) {
    const metrics = client.campaigns.flatMap((campaign) => campaign.metrics);

    const yesterday = metrics.filter((m) => m.date.getTime() === dayStart.getTime());
    const baseline = metrics.filter((m) => m.date.getTime() < dayStart.getTime());

    if (yesterday.length === 0 || baseline.length === 0) continue;

    const spendYesterday = sum(yesterday.map((m) => m.spend));
    const baselineDays = new Set(baseline.map((m) => m.date.getTime())).size;
    const avgSpend = sum(baseline.map((m) => m.spend)) / Math.max(1, baselineDays);

    if (avgSpend > 0 && spendYesterday > avgSpend * SPIKE_MULTIPLE) {
      anomalies.push({
        clientId: client.id,
        clientName: client.name,
        kind: "SPEND_SPIKE",
        message: `${client.name} spent ₹${Math.round(spendYesterday).toLocaleString("en-IN")} yesterday, more than ${SPIKE_MULTIPLE}× its ₹${Math.round(avgSpend).toLocaleString("en-IN")} daily average.`,
      });
    }

    const cplYesterday = average(yesterday.map((m) => m.cpl).filter(isNumber));
    const cplBaseline = average(baseline.map((m) => m.cpl).filter(isNumber));

    if (cplBaseline && cplYesterday && cplYesterday > cplBaseline * CPL_JUMP_MULTIPLE) {
      anomalies.push({
        clientId: client.id,
        clientName: client.name,
        kind: "CPL_JUMP",
        message: `${client.name}'s cost per lead rose to ₹${Math.round(cplYesterday).toLocaleString("en-IN")}, up from ₹${Math.round(cplBaseline).toLocaleString("en-IN")} on average.`,
      });
    }
  }

  return anomalies;
}

const isNumber = (value: number | null): value is number => value !== null;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const average = (values: number[]) =>
  values.length ? sum(values) / values.length : null;
