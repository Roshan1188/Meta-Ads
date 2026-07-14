import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { MAX_DAILY_BUDGET_RUPEES, rupeesToPaise } from "@/lib/money";
import {
  AccessError,
  assertAutopilotAllowed,
  requireClient,
  requirePermission,
} from "@/server/tenant";

const schema = z.object({
  clientId: z.string().min(1),
  autopilot: z.boolean(),
  requireApproval: z.boolean(),
  /** Null means no cap — allowed, but the UI warns about it. */
  maxDailyBudgetRupees: z
    .number()
    .int()
    .min(0)
    .max(MAX_DAILY_BUDGET_RUPEES)
    .nullable(),
});

export async function POST(req: Request) {
  try {
    const member = await requirePermission("automation:manage");

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input." },
        { status: 400 },
      );
    }

    const input = parsed.data;

    // Turning auto-pilot ON is the paid action. Turning it OFF must always be allowed,
    // even on a lapsed plan — never trap someone with an optimiser they can't stop.
    if (input.autopilot) assertAutopilotAllowed(member);

    const client = await requireClient(member, input.clientId);

    await db.client.update({
      where: { id: client.id },
      data: {
        autopilot: input.autopilot,
        requireApproval: input.requireApproval,
        maxDailyBudget:
          input.maxDailyBudgetRupees === null
            ? null
            : rupeesToPaise(input.maxDailyBudgetRupees),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[optimize/settings]", error);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }
}
