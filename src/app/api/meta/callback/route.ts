import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { exchangeCodeForLongLivedToken, OAUTH_STATE_COOKIE } from "@/lib/meta/oauth";

const settings = (params: string) =>
  NextResponse.redirect(new URL(`/settings/meta?${params}`, process.env.NEXTAUTH_URL));

/** Where Facebook sends the user back. Must match META_REDIRECT_URI exactly. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL));
  }

  const url = req.nextUrl;

  // The user hit "Cancel" on Facebook's dialog — not an error worth shouting about.
  if (url.searchParams.get("error")) {
    return settings("error=cancelled");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const store = await cookies();
  const expected = store.get(OAUTH_STATE_COOKIE)?.value;
  store.delete(OAUTH_STATE_COOKIE);

  if (!code || !state || !expected || state !== expected) {
    return settings("error=state_mismatch");
  }

  try {
    const { accessToken, expiresAt } = await exchangeCodeForLongLivedToken(code);

    // Re-connecting must reset the token but keep prior selections, so the user
    // doesn't have to re-pick their ad account every 60 days.
    await db.metaAuth.upsert({
      where: { userId: session.user.id },
      update: { accessToken, expiresAt },
      create: { userId: session.user.id, accessToken, expiresAt },
    });

    return settings("connected=1");
  } catch (error) {
    console.error("[meta/callback]", error);
    return settings("error=exchange_failed");
  }
}
