import "server-only";

import { graphGet, type Paged } from "./client";

export type AdAccount = {
  id: string; // "act_123..."
  name: string;
  currency: string;
  /** 1 = active. Anything else can't run ads. */
  account_status: number;
};

export type Page = { id: string; name: string };
export type InstagramAccount = { id: string; username: string };
export type Pixel = { id: string; name: string };

export async function listAdAccounts(token: string): Promise<AdAccount[]> {
  const res = await graphGet<Paged<AdAccount>>("/me/adaccounts", token, {
    fields: "id,name,currency,account_status",
    limit: "100",
  });
  return res.data;
}

export async function listPages(token: string): Promise<Page[]> {
  const res = await graphGet<Paged<Page>>("/me/accounts", token, {
    fields: "id,name",
    limit: "100",
  });
  return res.data;
}

/**
 * An Instagram account is reached through the Page it's linked to — there is no
 * "list my Instagram accounts" edge. No link means Instagram placements are simply
 * unavailable, which is a valid state, not an error.
 */
export async function getInstagramAccount(
  token: string,
  pageId: string,
): Promise<InstagramAccount | null> {
  const res = await graphGet<{
    instagram_business_account?: { id: string; username: string };
  }>(`/${pageId}`, token, { fields: "instagram_business_account{id,username}" });

  return res.instagram_business_account ?? null;
}

/** Needed for lead-optimised campaigns; absent for most new ad accounts. */
export async function listPixels(token: string, adAccountId: string): Promise<Pixel[]> {
  const res = await graphGet<Paged<Pixel>>(`/${adAccountId}/adspixels`, token, {
    fields: "id,name",
    limit: "50",
  });
  return res.data;
}
