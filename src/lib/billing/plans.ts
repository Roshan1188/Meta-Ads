/**
 * Plans. `razorpayPlanId` comes from the Razorpay dashboard — plans are created
 * there, not by us, so the ids live in env rather than the code.
 */

export const PLANS = ["FREE", "STARTER", "GROWTH", "AGENCY"] as const;
export type Plan = (typeof PLANS)[number];

export type PlanSpec = {
  name: string;
  /** Rupees per month. 0 for the free tier. */
  price: number;
  /** null means unlimited. */
  maxClients: number | null;
  maxCampaigns: number | null;
  /** Auto-pilot is a paid capability — it spends money on the user's behalf. */
  autopilot: boolean;
  whiteLabel: boolean;
  razorpayPlanId?: string;
  blurb: string;
};

export const PLAN_SPECS: Record<Plan, PlanSpec> = {
  FREE: {
    name: "Free",
    price: 0,
    maxClients: 1,
    maxCampaigns: 2,
    autopilot: false,
    whiteLabel: false,
    blurb: "Try the whole pipeline on one client.",
  },
  STARTER: {
    name: "Starter",
    price: 2_499,
    maxClients: 3,
    maxCampaigns: 10,
    autopilot: true,
    whiteLabel: false,
    razorpayPlanId: process.env.RAZORPAY_PLAN_STARTER,
    blurb: "For a freelancer running a handful of accounts.",
  },
  GROWTH: {
    name: "Growth",
    price: 6_999,
    maxClients: 10,
    maxCampaigns: 50,
    autopilot: true,
    whiteLabel: true,
    razorpayPlanId: process.env.RAZORPAY_PLAN_GROWTH,
    blurb: "For a small agency with a team.",
  },
  AGENCY: {
    name: "Agency",
    price: 17_999,
    maxClients: null,
    maxCampaigns: null,
    autopilot: true,
    whiteLabel: true,
    razorpayPlanId: process.env.RAZORPAY_PLAN_AGENCY,
    blurb: "Unlimited clients, white-label, priority support.",
  },
};

/** Statuses in which the agency still gets to use the product. */
const HEALTHY = new Set(["active", "created", "authenticated", "pending"]);

export function isHealthy(status: string): boolean {
  return HEALTHY.has(status);
}

export function planOf(subscription: { plan: string; status: string } | null): Plan {
  if (!subscription) return "FREE";
  // A halted or cancelled subscription drops the agency back to Free limits rather
  // than locking them out of their own data.
  if (!isHealthy(subscription.status)) return "FREE";

  return (PLANS as readonly string[]).includes(subscription.plan)
    ? (subscription.plan as Plan)
    : "FREE";
}
