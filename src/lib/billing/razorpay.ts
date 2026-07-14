import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { PLAN_SPECS, type Plan } from "./plans";

/**
 * Razorpay over plain REST, for the same reason as Meta: a typed fetch wrapper beats
 * an untyped SDK on the code path that takes people's money.
 */

const API = "https://api.razorpay.com/v1";

export const isRazorpayConfigured = Boolean(
  process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
);

export class BillingError extends Error {}

function authHeader(): string {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;

  if (!id || !secret) {
    throw new BillingError(
      "Billing isn't configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env.",
    );
  }
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { description?: string };
    };
    throw new BillingError(
      body.error?.description ?? `Razorpay rejected the request (${res.status}).`,
    );
  }
  return (await res.json()) as T;
}

export type RazorpaySubscription = {
  id: string;
  status: string;
  short_url: string;
  current_end?: number;
};

/**
 * Creates a subscription and returns the hosted checkout URL. We deliberately do not
 * build our own card form — staying off the PCI path is worth the redirect.
 */
export async function createSubscription(input: {
  plan: Plan;
  agencyId: string;
  email: string;
}): Promise<RazorpaySubscription> {
  const planId = PLAN_SPECS[input.plan].razorpayPlanId;
  if (!planId) {
    throw new BillingError(
      `No Razorpay plan id for ${input.plan}. Create the plan in the Razorpay dashboard and set RAZORPAY_PLAN_${input.plan} in .env.`,
    );
  }

  return call<RazorpaySubscription>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      plan_id: planId,
      total_count: 120, // 10 years of monthly cycles; cancellation ends it early.
      customer_notify: 1,
      // Comes back on every webhook, so we can find the agency without a lookup table.
      notes: { agencyId: input.agencyId, plan: input.plan, email: input.email },
    }),
  });
}

export async function cancelSubscription(razorpaySubId: string): Promise<void> {
  await call(`/subscriptions/${razorpaySubId}/cancel`, {
    method: "POST",
    // Let the customer keep what they've paid for until the period ends.
    body: JSON.stringify({ cancel_at_cycle_end: 1 }),
  });
}

/**
 * Verifies the webhook signature. Without this, anyone who knows the URL could POST
 * "subscription.activated" and upgrade themselves for free.
 */
export function verifyWebhook(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");

  // timingSafeEqual throws on a length mismatch, which is itself a signal — guard it.
  return a.length === b.length && timingSafeEqual(a, b);
}

export type WebhookEvent = {
  event: string;
  payload?: {
    subscription?: {
      entity?: {
        id: string;
        status: string;
        current_end?: number;
        notes?: { agencyId?: string; plan?: string };
      };
    };
  };
};
