import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { MetaApiError } from "@/lib/meta/client";
import { saveSelections } from "@/server/meta";

const schema = z.object({
  adAccountId: z.string().min(1, "Pick an ad account."),
  pageId: z.string().min(1, "Pick a Facebook Page."),
  pixelId: z.string().nullable(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "You need to be signed in." }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await saveSelections(session.user.id, parsed.data));
  } catch (error) {
    if (error instanceof MetaApiError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[meta/selections]", error);
    return NextResponse.json({ error: "Could not save your Meta settings." }, { status: 500 });
  }
}
