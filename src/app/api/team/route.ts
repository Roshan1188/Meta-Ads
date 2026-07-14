import { NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";

import { AccessError, requirePermission } from "@/server/tenant";
import { changeRole, inviteMember, removeMember, revokeInvite } from "@/server/team";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("invite"),
    email: z.string().email("Enter a valid email address."),
    role: z.nativeEnum(Role),
  }),
  z.object({ action: z.literal("revoke"), inviteId: z.string().min(1) }),
  z.object({
    action: z.literal("role"),
    userId: z.string().min(1),
    role: z.nativeEnum(Role),
  }),
  z.object({ action: z.literal("remove"), userId: z.string().min(1) }),
]);

export async function POST(req: Request) {
  try {
    const member = await requirePermission("team:manage");

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input." },
        { status: 400 },
      );
    }

    const input = parsed.data;

    switch (input.action) {
      case "invite": {
        const result = await inviteMember(member, {
          email: input.email,
          role: input.role,
        });
        // Return the link so an agency without RESEND_API_KEY can still send it by hand.
        return NextResponse.json({
          url: result.url,
          emailed: result.emailed,
          note: result.emailNote,
        });
      }
      case "revoke":
        await revokeInvite(member, input.inviteId);
        return NextResponse.json({ ok: true });

      case "role":
        await changeRole(member, input.userId, input.role);
        return NextResponse.json({ ok: true });

      case "remove":
        await removeMember(member, input.userId);
        return NextResponse.json({ ok: true });
    }
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[team]", error);
    return NextResponse.json({ error: "Could not update the team." }, { status: 500 });
  }
}
