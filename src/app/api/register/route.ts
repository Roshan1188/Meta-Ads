import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { db } from "@/lib/db";
import { registerSchema } from "@/lib/validations/auth";
import { findInvite } from "@/server/team";

export async function POST(req: Request) {
  const parsed = registerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const { name, email, password, inviteToken } = parsed.data;
  const normalisedEmail = email.toLowerCase();

  const existing = await db.user.findUnique({ where: { email: normalisedEmail } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with that email already exists." },
      { status: 409 },
    );
  }

  // Signing up from an invitation joins that agency instead of creating a new one.
  // Without this branch an invitee would land in an agency of one and never see the
  // team that invited them.
  if (inviteToken) {
    const found = await findInvite(inviteToken);
    if (found.state !== "valid") {
      return NextResponse.json(
        { error: "That invitation is no longer valid." },
        { status: 410 },
      );
    }
    if (found.invite.email.toLowerCase() !== normalisedEmail) {
      return NextResponse.json(
        { error: `That invitation was sent to ${found.invite.email}.` },
        { status: 400 },
      );
    }

    const invited = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name,
          email: normalisedEmail,
          passwordHash: await bcrypt.hash(password, 12),
          role: found.invite.role,
          agencyId: found.invite.agencyId,
        },
        select: { id: true, email: true },
      });

      await tx.invite.update({
        where: { id: found.invite.id },
        data: { acceptedAt: new Date() },
      });

      return created;
    });

    return NextResponse.json({ user: invited }, { status: 201 });
  }

  // Everyone else gets an agency, even a solo user — an "agency of one" means there
  // is one tenant model instead of two code paths that drift apart.
  const user = await db.$transaction(async (tx) => {
    const agency = await tx.agency.create({
      data: {
        name: `${name}'s agency`,
        slug: await uniqueSlug(tx, name),
        subscription: { create: { plan: "FREE", status: "active" } },
      },
    });

    return tx.user.create({
      data: {
        name,
        email: normalisedEmail,
        passwordHash: await bcrypt.hash(password, 12),
        role: "OWNER",
        agencyId: agency.id,
      },
      select: { id: true, email: true },
    });
  });

  return NextResponse.json({ user }, { status: 201 });
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function uniqueSlug(tx: Tx, name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30) || "agency";

  for (let attempt = 0; ; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt}`;
    const taken = await tx.agency.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
  }
}
