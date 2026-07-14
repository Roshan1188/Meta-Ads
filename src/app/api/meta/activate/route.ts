import { NextResponse } from "next/server";
import { z } from "zod";

import { MetaApiError } from "@/lib/meta/client";
import { setCampaignStatus } from "@/server/publish";
import { AccessError, requirePermission } from "@/server/tenant";

const schema = z.object({
  campaignId: z.string().min(1),
  status: z.enum(["ACTIVE", "PAUSED"]),
  /**
   * The client must echo back the exact daily budget it showed the user before we
   * let anything go live. If it doesn't match what's in the database, the user was
   * looking at a stale number — refuse rather than start spending on their behalf.
   */
  confirmDailyBudget: z.number().int().optional(),
});

export async function POST(req: Request) {
  try {
    const member = await requirePermission("campaign:activate");

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input." }, { status: 400 });
    }

    const { campaignId, status, confirmDailyBudget } = parsed.data;

    if (status === "ACTIVE" && confirmDailyBudget === undefined) {
      return NextResponse.json(
        { error: "Confirm the daily budget before going live." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      await setCampaignStatus(member.agencyId, campaignId, status, confirmDailyBudget),
    );
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof MetaApiError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[meta/activate]", error);
    return NextResponse.json({ error: "Could not update the campaign." }, { status: 500 });
  }
}
