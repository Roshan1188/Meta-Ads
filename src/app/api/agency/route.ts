import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { AccessError, assertWhiteLabelAllowed, requirePermission } from "@/server/tenant";

const schema = z.object({
  name: z.string().min(1, "Name is required.").max(80),
  /** Hex. Anything else would land straight in a CSS variable and an email header. */
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour, e.g. #1E5631.")
    .nullable(),
  logoUrl: z.string().url("Enter a valid image URL.").nullable(),
  reportHeader: z.string().max(80).nullable(),
  customDomain: z
    .string()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Enter a domain like reports.myagency.com.")
    .nullable(),
});

export async function POST(req: Request) {
  try {
    const member = await requirePermission("branding:manage");

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input." },
        { status: 400 },
      );
    }

    const input = parsed.data;

    // The name is always editable; the white-label fields are a paid capability.
    const brandingChanged =
      input.brandColor !== null ||
      input.logoUrl !== null ||
      input.reportHeader !== null ||
      input.customDomain !== null;

    if (brandingChanged) assertWhiteLabelAllowed(member);

    await db.agency.update({
      where: { id: member.agencyId },
      data: input,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[agency]", error);
    return NextResponse.json({ error: "Could not save branding." }, { status: 500 });
  }
}
