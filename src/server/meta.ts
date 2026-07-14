import "server-only";

import { MetaApiError } from "@/lib/meta/client";
import {
  getInstagramAccount,
  listAdAccounts,
  listPages,
  listPixels,
  type AdAccount,
  type Page,
  type Pixel,
} from "@/lib/meta/accounts";
import { db } from "@/lib/db";

/** A connection that is actually usable for publishing — all required IDs present. */
export type ReadyConnection = {
  accessToken: string;
  adAccountId: string;
  currency: string;
  pageId: string;
  igAccountId: string | null;
  pixelId: string | null;
};

export async function getConnection(userId: string) {
  return db.metaAuth.findUnique({ where: { userId } });
}

function assertUsable(auth: {
  accessToken: string;
  expiresAt: Date | null;
  adAccountId: string | null;
  pageId: string | null;
}) {
  if (auth.expiresAt && auth.expiresAt < new Date()) {
    throw new MetaApiError("The Facebook connection has expired. Reconnect it in Settings.");
  }
  if (!auth.adAccountId || !auth.pageId) {
    throw new MetaApiError(
      "Finish connecting Meta: pick an ad account and a Facebook Page in Settings → Meta.",
    );
  }
}

/** The signed-in user's own connection. Used by the settings screen. */
export async function requireConnection(userId: string): Promise<ReadyConnection> {
  const auth = await getConnection(userId);
  if (!auth) {
    throw new MetaApiError("Connect your Facebook account in Settings → Meta first.");
  }
  assertUsable(auth);

  return {
    accessToken: auth.accessToken,
    adAccountId: auth.adAccountId!,
    currency: auth.currency ?? "INR",
    pageId: auth.pageId!,
    igAccountId: auth.igAccountId,
    pixelId: auth.pixelId,
  };
}

/**
 * The connection a *client* publishes through.
 *
 * The Facebook token belongs to whichever team member connected it; where a client's
 * ads land is a per-client choice. Background jobs (the nightly optimiser, scheduled
 * activation) have no logged-in user, so the client remembers whose token to use —
 * otherwise a cron would have no credential at all.
 */
export async function connectionForClient(clientId: string): Promise<ReadyConnection> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    include: {
      agency: {
        include: {
          users: {
            where: { metaAuth: { isNot: null } },
            include: { metaAuth: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!client) throw new MetaApiError("Client not found.");

  const candidates = client.agency.users;
  const preferred = client.metaAuthUserId
    ? candidates.find((user) => user.id === client.metaAuthUserId)
    : undefined;

  const auth = (preferred ?? candidates[0])?.metaAuth;
  if (!auth) {
    throw new MetaApiError(
      `Nobody on this agency has connected Facebook, so ${client.name} can't publish. Connect it in Settings → Meta.`,
    );
  }

  // Per-client destination wins; otherwise fall back to the connector's default.
  const adAccountId = client.metaAdAccountId ?? auth.adAccountId;
  const pageId = client.metaPageId ?? auth.pageId;

  assertUsable({ ...auth, adAccountId, pageId });

  return {
    accessToken: auth.accessToken,
    adAccountId: adAccountId!,
    currency: auth.currency ?? "INR",
    pageId: pageId!,
    igAccountId: client.metaIgAccountId ?? auth.igAccountId,
    pixelId: client.metaPixelId ?? auth.pixelId,
  };
}

export type MetaOptions = {
  adAccounts: AdAccount[];
  pages: Page[];
  pixels: Pixel[];
};

/** Everything the settings screen needs to render its dropdowns. */
export async function loadMetaOptions(
  token: string,
  adAccountId?: string | null,
): Promise<MetaOptions> {
  const [adAccounts, pages] = await Promise.all([listAdAccounts(token), listPages(token)]);

  // Pixels are scoped to an ad account, so they can't be listed until one is chosen.
  const pixels = adAccountId ? await listPixels(token, adAccountId).catch(() => []) : [];

  return { adAccounts, pages, pixels };
}

export async function saveSelections(
  userId: string,
  input: { adAccountId: string; pageId: string; pixelId: string | null },
) {
  const auth = await getConnection(userId);
  if (!auth) throw new MetaApiError("Connect Facebook first.");

  const [adAccounts, pages] = await Promise.all([
    listAdAccounts(auth.accessToken),
    listPages(auth.accessToken),
  ]);

  // Never trust an id posted from the browser — confirm the user actually has it.
  const adAccount = adAccounts.find((account) => account.id === input.adAccountId);
  const page = pages.find((candidate) => candidate.id === input.pageId);

  if (!adAccount) throw new MetaApiError("You don't have access to that ad account.");
  if (!page) throw new MetaApiError("You don't have access to that Page.");

  if (adAccount.account_status !== 1) {
    throw new MetaApiError(
      `That ad account isn't active (status ${adAccount.account_status}), so Meta will reject any campaign on it.`,
    );
  }

  // Instagram is optional — its absence just means Facebook-only placements.
  const instagram = await getInstagramAccount(auth.accessToken, page.id).catch(() => null);

  await db.metaAuth.update({
    where: { userId },
    data: {
      adAccountId: adAccount.id,
      adAccountName: adAccount.name,
      currency: adAccount.currency,
      pageId: page.id,
      pageName: page.name,
      igAccountId: instagram?.id ?? null,
      pixelId: input.pixelId,
    },
  });

  return { instagramConnected: Boolean(instagram) };
}
