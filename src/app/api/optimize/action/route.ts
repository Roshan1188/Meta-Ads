import { NextResponse } from "next/server";
import { z } from "zod";

import { MetaApiError } from "@/lib/meta/client";
import { approve, reject, revert } from "@/server/optimize";
import { AccessError, requirePermission } from "@/server/tenant";

const schema = z.object({
  logId: z.string().min(1),
  decision: z.enum(["approve", "reject", "revert"]),
});

/** The human overrides on the optimisation timeline. */
export async function POST(req: Request) {
  try {
    const member = await requirePermission("automation:manage");

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input." }, { status: 400 });
    }

    const { logId, decision } = parsed.data;

    if (decision === "approve") await approve(member.agencyId, logId);
    else if (decision === "reject") await reject(member.agencyId, logId);
    else await revert(member.agencyId, logId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof MetaApiError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[optimize/action]", error);
    return NextResponse.json({ error: "Could not update that action." }, { status: 500 });
  }
}
