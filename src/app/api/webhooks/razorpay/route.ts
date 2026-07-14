import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { verifyWebhook, type WebhookEvent } from "@/lib/billing/razorpay";
import { PLANS, type Plan } from "@/lib/billing/plans";

/**
 * Razorpay's word on what an agency has actually paid for. This — not the checkout
 * redirect — is what grants a plan; a user who closes the payment page must not end
 * up on a paid tier, and one who pays must get it even if they never come back.
 */
export async function POST(req: Request) {
  // The signature is over the exact bytes, so the body must be read raw. Parsing it
  // first and re-serialising would change the whitespace and break verification.
  const raw = await req.text();

  if (!verifyWebhook(raw, req.headers.get("x-razorpay-signature"))) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(raw) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }

  const entity = event.payload?.subscription?.entity;
  if (!entity) {
    // Not a subscription event. Acknowledge so Razorpay stops retrying it.
    return NextResponse.json({ ok: true });
  }

  const agencyId = entity.notes?.agencyId;
  if (!agencyId) {
    console.warn("[razorpay] subscription with no agencyId note:", entity.id);
    return NextResponse.json({ ok: true });
  }

  const plan = toPlan(entity.notes?.plan);
  const periodEnd = entity.current_end ? new Date(entity.current_end * 1000) : null;

  switch (event.event) {
    case "subscription.activated":
    case "subscription.charged":
    case "subscription.resumed":
      await db.subscription.upsert({
        where: { agencyId },
        update: {
          plan,
          status: "active",
          razorpaySubId: entity.id,
          currentPeriodEnd: periodEnd,
        },
        create: {
          agencyId,
          plan,
          status: "active",
          razorpaySubId: entity.id,
          currentPeriodEnd: periodEnd,
        },
      });
      break;

    case "subscription.halted":
    case "subscription.pending":
    case "subscription.cancelled":
    case "subscription.completed":
      // Downgrade to the free tier's limits rather than locking the agency out of
      // its own data. `planOf` treats any unhealthy status as FREE.
      await db.subscription.updateMany({
        where: { agencyId },
        data: { status: entity.status, currentPeriodEnd: periodEnd },
      });
      break;

    default:
      break;
  }

  return NextResponse.json({ ok: true });
}

function toPlan(value: string | undefined): Plan {
  return (PLANS as readonly string[]).includes(value ?? "") ? (value as Plan) : "FREE";
}
