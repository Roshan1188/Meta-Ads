import "server-only";

import type { Role } from "@prisma/client";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, type Permission } from "@/lib/permissions";
import { PLAN_SPECS, planOf, type Plan } from "@/lib/billing/plans";

/**
 * The single door into every tenant-scoped query. Nothing in the app should read a
 * Client, Campaign, or Ad without going through `requireMember` first — that's what
 * makes row-level ownership enforceable rather than aspirational.
 */

export class AccessError extends Error {
  constructor(
    message: string,
    readonly status = 403,
  ) {
    super(message);
  }
}

export type Member = {
  userId: string;
  agencyId: string;
  role: Role;
  plan: Plan;
};

export async function requireMember(): Promise<Member> {
  const session = await auth();
  if (!session?.user) throw new AccessError("You need to be signed in.", 401);

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { agency: { include: { subscription: true } } },
  });

  if (!user?.agencyId || !user.agency) {
    throw new AccessError("Your account isn't attached to an agency.", 403);
  }

  return {
    userId: user.id,
    agencyId: user.agencyId,
    role: user.role,
    plan: planOf(user.agency.subscription),
  };
}

export async function requirePermission(permission: Permission): Promise<Member> {
  const member = await requireMember();

  if (!can(member.role, permission)) {
    throw new AccessError(
      `Your role (${member.role.toLowerCase()}) can't do that. Ask an admin.`,
    );
  }
  return member;
}

/**
 * Confirms a client belongs to the caller's agency. Every route that takes a
 * clientId from the browser must call this — an id alone is not authorisation.
 */
export async function requireClient(member: Member, clientId: string) {
  const client = await db.client.findFirst({
    where: { id: clientId, agencyId: member.agencyId },
  });
  if (!client) throw new AccessError("Client not found.", 404);
  return client;
}

// --- Plan limits ---------------------------------------------------------

export async function assertCanAddClient(member: Member) {
  const limit = PLAN_SPECS[member.plan].maxClients;
  if (limit === null) return;

  const count = await db.client.count({ where: { agencyId: member.agencyId } });
  if (count >= limit) {
    throw new AccessError(
      `Your ${PLAN_SPECS[member.plan].name} plan allows ${limit} client${limit === 1 ? "" : "s"}. Upgrade to add more.`,
      402,
    );
  }
}

export async function assertCanAddCampaign(member: Member) {
  const limit = PLAN_SPECS[member.plan].maxCampaigns;
  if (limit === null) return;

  const count = await db.campaign.count({
    where: { client: { agencyId: member.agencyId } },
  });
  if (count >= limit) {
    throw new AccessError(
      `Your ${PLAN_SPECS[member.plan].name} plan allows ${limit} campaigns. Upgrade to publish more.`,
      402,
    );
  }
}

export function assertAutopilotAllowed(member: Member) {
  if (!PLAN_SPECS[member.plan].autopilot) {
    throw new AccessError(
      `Auto-pilot isn't included in the ${PLAN_SPECS[member.plan].name} plan. Upgrade to let the optimiser act on your behalf.`,
      402,
    );
  }
}

export function assertWhiteLabelAllowed(member: Member) {
  if (!PLAN_SPECS[member.plan].whiteLabel) {
    throw new AccessError(
      `White-label branding isn't included in the ${PLAN_SPECS[member.plan].name} plan.`,
      402,
    );
  }
}
