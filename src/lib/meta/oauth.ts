import "server-only";

import { graphGet, META_API_VERSION, MetaApiError } from "./client";

/**
 * `ads_management` and `business_management` are the ones that require Meta App
 * Review plus Business Verification before non-developer users can grant them.
 * See the README — build against a Test User until that's approved.
 */
/** Holds the CSRF nonce between /connect and /callback. */
export const OAUTH_STATE_COOKIE = "meta_oauth_state";

export const META_SCOPES = [
  "ads_management",
  "ads_read",
  "business_management",
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
] as const;

export const isMetaConfigured = Boolean(
  process.env.META_APP_ID && process.env.META_APP_SECRET,
);

function requireConfig() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;

  if (!appId || !appSecret || !redirectUri) {
    throw new MetaApiError(
      "Meta isn't configured. Set META_APP_ID, META_APP_SECRET, and META_REDIRECT_URI in .env.",
    );
  }
  return { appId, appSecret, redirectUri };
}

/** `state` is a CSRF nonce we mint and check against a cookie on the way back. */
export function buildAuthUrl(state: string): string {
  const { appId, redirectUri } = requireConfig();

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    scope: META_SCOPES.join(","),
  });

  return `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?${params}`;
}

type TokenResponse = { access_token: string; expires_in?: number };

/**
 * The code exchange returns a short-lived (~1h) token, which is useless for a
 * background job. Immediately swap it for the long-lived (~60d) one.
 */
export async function exchangeCodeForLongLivedToken(code: string): Promise<{
  accessToken: string;
  expiresAt: Date | null;
}> {
  const { appId, appSecret, redirectUri } = requireConfig();

  const shortLived = await graphGet<TokenResponse>("/oauth/access_token", "", {
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });

  const longLived = await graphGet<TokenResponse>("/oauth/access_token", "", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLived.access_token,
  });

  return {
    accessToken: longLived.access_token,
    expiresAt: longLived.expires_in
      ? new Date(Date.now() + longLived.expires_in * 1000)
      : null,
  };
}
