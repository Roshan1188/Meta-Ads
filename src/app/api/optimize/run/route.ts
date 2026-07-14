import { NextResponse } from "next/server";
import { z } from "zod";

import { MetaApiError } from "@/lib/meta/client";
import { optimiseClient, syncClientMetrics } from "@/server/optimize";
import { AccessError, requireClient, requirePermission } from "@/server/tenant";

// Syncing insights for every ad then deciding is slow.
export const maxDuration = 300;

const schema = z.object({ clientId: z.string().min(1) });

/**
 * "Run now" — the same work the nightly cron does, on demand. Useful for seeing what
 * the optimiser would do without waiting until 03:00.
 */
export async function POST(req: Request) {
  try {
    const member = await requirePermission("automation:manage");

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input." }, { status: 400 });
    }

    const client = await requireClient(member, parsed.data.clientId);

    const synced = await syncClientMetrics(client.id);
    const result = await optimiseClient(client.id);

    return NextResponse.json({
      ...synced,
      ...result,
      // Be explicit rather than reporting "0 decisions" as if the rules found nothing.
      message:
        result.skipped === "autopilot_off"
          ? "Metrics synced. Auto-pilot is off, so no decisions were made."
          : result.skipped === "plan"
            ? "Metrics synced. Auto-pilot isn't included in your plan, so no decisions were made."
            : `Metrics synced. ${result.decisions} decision${result.decisions === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof MetaApiError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[optimize/run]", error);
    return NextResponse.json({ error: "Optimisation failed." }, { status: 500 });
  }
}
