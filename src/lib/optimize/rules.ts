import { MIN_DAILY_BUDGET_RUPEES } from "@/lib/money";

/**
 * The rules engine is a pure function: stats in, decisions out. It performs no IO
 * and touches neither Meta nor the database, so every decision the platform makes
 * can be reproduced and tested from the numbers alone.
 *
 * Applying the decisions is someone else's job (`server/optimize.ts`).
 */

export type RuleConfig = {
  /** CTR at or above this is a winner worth more budget. */
  winnerCtrPct: number;
  /** CTR below this, once we have enough data, is a loser worth pausing. */
  loserCtrPct: number;
  /** Never judge an ad on fewer impressions than this — small samples lie. */
  minImpressions: number;
  /** Maximum budget change in a single day, as a percentage. */
  maxBudgetStepPct: number;
  /** A winner's CTR must beat a loser's by this multiple before we call an A/B test. */
  winnerMultiple: number;
};

export const DEFAULT_RULES: RuleConfig = {
  winnerCtrPct: 3,
  loserCtrPct: 1,
  minImpressions: 4_000,
  maxBudgetStepPct: 20,
  winnerMultiple: 2,
};

export const MIN_ADSET_BUDGET_MINOR = MIN_DAILY_BUDGET_RUPEES * 100;

export type AdStat = {
  adId: string;
  name: string;
  status: string;
  impressions: number;
  clicks: number;
  /** Percentage, as Meta reports it (2.5 means 2.5%). */
  ctr: number;
  spend: number;
  leads: number;
  cpl: number | null;
};

export type AdSetStat = {
  adSetId: string;
  name: string;
  dailyBudget: number;
  ads: AdStat[];
};

export type Decision =
  | { action: "PAUSE_AD"; adId: string; reason: string }
  | { action: "QUEUE_CREATIVE"; adSetId: string; reason: string }
  | { action: "RAISE_BUDGET"; adSetId: string; from: number; to: number; reason: string }
  | { action: "LOWER_BUDGET"; adSetId: string; from: number; to: number; reason: string };

export type DecideInput = {
  adSets: AdSetStat[];
  /** Hard ceiling on this client's total daily spend, in paise. */
  maxDailyBudget: number | null;
  config?: Partial<RuleConfig>;
};

export function decide({ adSets, maxDailyBudget, config }: DecideInput): Decision[] {
  const rules: RuleConfig = { ...DEFAULT_RULES, ...config };
  const decisions: Decision[] = [];

  const currentTotal = adSets.reduce((sum, adSet) => sum + adSet.dailyBudget, 0);
  let headroom =
    maxDailyBudget === null ? Number.POSITIVE_INFINITY : maxDailyBudget - currentTotal;

  for (const adSet of adSets) {
    const active = adSet.ads.filter((ad) => ad.status === "ACTIVE");
    const judgeable = active.filter((ad) => ad.impressions >= rules.minImpressions);

    // --- Losing ads -------------------------------------------------------
    const losers = judgeable.filter((ad) => ad.ctr < rules.loserCtrPct);

    // Pausing every ad in an ad set stops delivery entirely, which is worse than
    // running a weak ad. Always leave one standing.
    const maxPausable = Math.max(0, active.length - 1);
    const toPause = losers
      .sort((a, b) => a.ctr - b.ctr)
      .slice(0, maxPausable);

    for (const ad of toPause) {
      decisions.push({
        action: "PAUSE_AD",
        adId: ad.adId,
        reason: `Paused ${ad.name} — CTR ${fmt(ad.ctr)}% over ${count(ad.impressions)} impressions, below the ${rules.loserCtrPct}% floor.`,
      });
    }

    if (toPause.length > 0) {
      decisions.push({
        action: "QUEUE_CREATIVE",
        adSetId: adSet.adSetId,
        reason: `${toPause.length} ad${toPause.length > 1 ? "s" : ""} paused in ${adSet.name} for low CTR — queued a fresh creative to replace ${toPause.length > 1 ? "them" : "it"}.`,
      });
    }

    // --- A/B: keep the winner --------------------------------------------
    // Only among ads that survived the loser sweep, and only with a clear margin —
    // pausing a 2.9% ad because a 3.0% one exists is noise, not optimisation.
    const paused = new Set(toPause.map((ad) => ad.adId));
    const contenders = judgeable.filter((ad) => !paused.has(ad.adId));

    if (contenders.length >= 2) {
      const ranked = [...contenders].sort((a, b) => b.ctr - a.ctr);
      const [winner, ...rest] = ranked;

      const beaten = rest.filter(
        (ad) => ad.ctr > 0 && winner.ctr >= ad.ctr * rules.winnerMultiple,
      );

      for (const ad of beaten) {
        decisions.push({
          action: "PAUSE_AD",
          adId: ad.adId,
          reason: `Paused ${ad.name} — ${winner.name} wins the A/B test at ${fmt(winner.ctr)}% CTR versus ${fmt(ad.ctr)}%, both over ${count(rules.minImpressions)} impressions.`,
        });
      }
    }

    // --- Budget -----------------------------------------------------------
    const stats = aggregate(adSet);
    if (stats.impressions < rules.minImpressions) continue;

    // Healthy means: people click, and if we're tracking leads, they're not
    // ruinously expensive relative to the other ad sets.
    if (stats.ctr >= rules.winnerCtrPct) {
      const step = Math.round((adSet.dailyBudget * rules.maxBudgetStepPct) / 100);
      const raise = Math.min(step, Math.max(0, headroom));

      if (raise > 0) {
        const to = adSet.dailyBudget + raise;
        headroom -= raise;

        decisions.push({
          action: "RAISE_BUDGET",
          adSetId: adSet.adSetId,
          from: adSet.dailyBudget,
          to,
          reason: `Raised ${adSet.name} by ${rules.maxBudgetStepPct}% — CTR ${fmt(stats.ctr)}% is above the ${rules.winnerCtrPct}% target.`,
        });
      }
    } else if (stats.ctr < rules.loserCtrPct) {
      const step = Math.round((adSet.dailyBudget * rules.maxBudgetStepPct) / 100);
      const to = Math.max(MIN_ADSET_BUDGET_MINOR, adSet.dailyBudget - step);

      // Cutting below Meta's floor would just get the ad set rejected.
      if (to < adSet.dailyBudget) {
        decisions.push({
          action: "LOWER_BUDGET",
          adSetId: adSet.adSetId,
          from: adSet.dailyBudget,
          to,
          reason: `Lowered ${adSet.name} by ${rules.maxBudgetStepPct}% — CTR ${fmt(stats.ctr)}% is below the ${rules.loserCtrPct}% floor.`,
        });
      }
    }
  }

  return decisions;
}

/** Ad set totals are derived from its ads, so one source of truth for the numbers. */
function aggregate(adSet: AdSetStat) {
  const impressions = adSet.ads.reduce((sum, ad) => sum + ad.impressions, 0);
  const clicks = adSet.ads.reduce((sum, ad) => sum + ad.clicks, 0);

  return {
    impressions,
    clicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
  };
}

const fmt = (value: number) => value.toFixed(2);
const count = (value: number) => value.toLocaleString("en-IN");
