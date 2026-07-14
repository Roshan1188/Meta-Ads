import "server-only";

import { graphGet, type Paged } from "./client";

export type Insights = {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  /** Cost per lead — only present once the campaign records lead actions. */
  cpl: number | null;
  leads: number;
};

type RawInsights = {
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  actions?: { action_type: string; value: string }[];
};

/** The action types Meta uses for a website lead, in priority order. */
const LEAD_ACTIONS = ["offsite_conversion.fb_pixel_lead", "lead", "onsite_conversion.lead_grouped"];

export type DatePreset = "today" | "yesterday" | "last_7d" | "last_30d" | "maximum";

/**
 * Insights come back as strings, and a campaign with no delivery returns an empty
 * array rather than zeroes — so a paused campaign must read as 0, not as an error.
 */
export async function getInsights(
  token: string,
  entityId: string,
  datePreset: DatePreset = "last_7d",
): Promise<Insights> {
  const res = await graphGet<Paged<RawInsights>>(`/${entityId}/insights`, token, {
    fields: "spend,impressions,clicks,ctr,cpc,actions",
    date_preset: datePreset,
  });

  const row = res.data[0];
  if (!row) {
    return { spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, cpl: null, leads: 0 };
  }

  const spend = num(row.spend);
  const leads = countLeads(row.actions);

  return {
    spend,
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    ctr: num(row.ctr),
    cpc: num(row.cpc),
    leads,
    cpl: leads > 0 ? spend / leads : null,
  };
}

function num(value?: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function countLeads(actions?: { action_type: string; value: string }[]): number {
  if (!actions) return 0;

  for (const type of LEAD_ACTIONS) {
    const hit = actions.find((action) => action.action_type === type);
    if (hit) return num(hit.value);
  }
  return 0;
}
