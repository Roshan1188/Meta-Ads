import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { BillingError, createSubscription } from "@/lib/billing/razorpay";
import { PLANS } from "@/lib/billing/plans";
import { AccessError, requirePermission } from "@/server/tenant";

const schema = z.object({
  plan: z.enum(PLANS).refine((plan) => plan !== "FREE", {
    message: "Pick a paid plan.",
  }),
});

export async function POST(req: Request) {
  try {
    const member = await requirePermission("billing:manage");

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid plan." },
        { status: 400 },
      );
    }

    const user = await db.user.findUnique({
      where: { id: member.userId },
      select: { email: true },
    });

    const subscription = await createSubscription({
      plan: parsed.data.plan,
      agencyId: member.agencyId,
      email: user!.email,
    });

    // Record it as pending. The webhook is what actually grants the plan — a user who
    // abandons the checkout page must not end up on a paid tier.
    await db.subscription.upsert({
      where: { agencyId: member.agencyId },
      update: { razorpaySubId: subscription.id, status: subscription.status },
      create: {
        agencyId: member.agencyId,
        plan: "FREE",
        status: subscription.status,
        razorpaySubId: subscription.id,
      },
    });

    return NextResponse.json({ checkoutUrl: subscription.short_url });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof BillingError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[billing/subscribe]", error);
    return NextResponse.json({ error: "Could not start checkout." }, { status: 500 });
  }
}
