import "server-only";

import { randomBytes } from "node:crypto";
import type { Role } from "@prisma/client";

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/notify/email";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/permissions";
import { AccessError, type Member } from "./tenant";

const INVITE_TTL_DAYS = 7;

function assertAssignable(role: Role) {
  if (!ASSIGNABLE_ROLES.includes(role)) {
    // There is exactly one Owner, created at sign-up. Letting anyone mint another
    // would hand over billing control with no audit trail.
    throw new AccessError("You can't assign the Owner role.");
  }
}

export async function listTeam(agencyId: string) {
  const [members, invites] = await Promise.all([
    db.user.findMany({
      where: { agencyId },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.invite.findMany({
      where: { agencyId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return { members, invites };
}

export async function inviteMember(
  member: Member,
  input: { email: string; role: Role },
) {
  assertAssignable(input.role);

  const email = input.email.toLowerCase();

  const existing = await db.user.findUnique({
    where: { email },
    select: { agencyId: true },
  });
  if (existing?.agencyId === member.agencyId) {
    throw new AccessError("They're already on your team.", 409);
  }
  if (existing) {
    // Moving a user between agencies would silently orphan whatever they own in the
    // other one. Out of scope, and a footgun to do implicitly.
    throw new AccessError(
      "That email already has an account on another agency. They'll need to use a different address.",
      409,
    );
  }

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);

  const invite = await db.invite.upsert({
    where: { agencyId_email: { agencyId: member.agencyId, email } },
    update: { role: input.role, token, expiresAt, acceptedAt: null },
    create: { agencyId: member.agencyId, email, role: input.role, token, expiresAt },
    include: { agency: { select: { name: true } } },
  });

  const url = `${process.env.NEXTAUTH_URL}/invite/${token}`;

  // The invite is valid whether or not the email lands — surface the link so an
  // unconfigured RESEND_API_KEY doesn't silently strand the invitee.
  const delivery = await sendEmail({
    to: email,
    subject: `You've been invited to ${invite.agency.name}`,
    html: `<p>You've been invited to join <strong>${invite.agency.name}</strong> as a ${ROLE_LABELS[input.role]}.</p>
           <p><a href="${url}">Accept the invitation</a></p>
           <p style="color:#666;font-size:12px;">The link expires in ${INVITE_TTL_DAYS} days.</p>`,
  }).catch((error: Error) => ({ sent: false, skipped: error.message }));

  return { invite, url, emailed: delivery.sent, emailNote: delivery.skipped };
}

export async function revokeInvite(member: Member, inviteId: string) {
  const { count } = await db.invite.deleteMany({
    where: { id: inviteId, agencyId: member.agencyId },
  });
  if (count === 0) throw new AccessError("Invite not found.", 404);
}

export async function changeRole(member: Member, userId: string, role: Role) {
  assertAssignable(role);

  const target = await db.user.findFirst({
    where: { id: userId, agencyId: member.agencyId },
  });
  if (!target) throw new AccessError("Member not found.", 404);

  if (target.role === "OWNER") {
    throw new AccessError("The Owner's role can't be changed.");
  }

  await db.user.update({ where: { id: target.id }, data: { role } });
}

export async function removeMember(member: Member, userId: string) {
  if (userId === member.userId) {
    throw new AccessError("You can't remove yourself.");
  }

  const target = await db.user.findFirst({
    where: { id: userId, agencyId: member.agencyId },
  });
  if (!target) throw new AccessError("Member not found.", 404);

  if (target.role === "OWNER") {
    throw new AccessError("The Owner can't be removed.");
  }

  // Detach rather than delete: their clients and campaigns belong to the agency, and
  // deleting the user would cascade those away.
  await db.user.update({
    where: { id: target.id },
    data: { agencyId: null, role: "EMPLOYEE" },
  });
}

/** Looks up an invite for the accept screen. Never throws — the page renders the state. */
export async function findInvite(token: string) {
  const invite = await db.invite.findUnique({
    where: { token },
    include: { agency: { select: { name: true } } },
  });

  if (!invite) return { state: "missing" as const };
  if (invite.acceptedAt) return { state: "used" as const };
  if (invite.expiresAt < new Date()) return { state: "expired" as const };

  return { state: "valid" as const, invite };
}

/** Called from the register route and the accept page. */
export async function acceptInvite(token: string, userId: string, email: string) {
  const found = await findInvite(token);
  if (found.state !== "valid") {
    throw new AccessError("That invitation is no longer valid.", 410);
  }

  const { invite } = found;
  if (invite.email.toLowerCase() !== email.toLowerCase()) {
    throw new AccessError(
      `That invitation was sent to ${invite.email}. Sign in with that address instead.`,
    );
  }

  await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: { agencyId: invite.agencyId, role: invite.role },
    }),
    db.invite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    }),
  ]);

  return { agencyId: invite.agencyId };
}
