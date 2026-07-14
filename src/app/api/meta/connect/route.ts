import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { auth } from "@/lib/auth";
import { buildAuthUrl, isMetaConfigured, OAUTH_STATE_COOKIE } from "@/lib/meta/oauth";

/** Starts the Facebook OAuth dance. */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL));
  }

  if (!isMetaConfigured) {
    return NextResponse.redirect(
      new URL("/settings/meta?error=not_configured", process.env.NEXTAUTH_URL),
    );
  }

  // CSRF: Meta echoes `state` back, and we only accept it if it matches this cookie.
  const state = randomBytes(16).toString("hex");

  const store = await cookies();
  store.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(buildAuthUrl(state));
}
