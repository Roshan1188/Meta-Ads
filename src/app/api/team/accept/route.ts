import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { AccessError } from "@/server/tenant";
import { acceptInvite } from "@/server/team";

const schema = z.object({ token: z.string().min(1) });

/**
 * Accepting an invite as an already-signed-in user. Deliberately not behind
 * `requireMember` — the whole point is that the caller may not belong to an agency yet.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "You need to be signed in." }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  });

  try {
    await acceptInvite(parsed.data.token, session.user.id, user!.email);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[team/accept]", error);
    return NextResponse.json({ error: "Could not accept the invitation." }, { status: 500 });
  }
}
