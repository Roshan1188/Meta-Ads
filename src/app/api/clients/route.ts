import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { AccessError, requireClient, requirePermission } from "@/server/tenant";
import { buildReport, deliverReport } from "@/server/reports";

const settingsSchema = z.object({
  action: z.literal("settings"),
  clientId: z.string().min(1),
  contactEmail: z.string().email("Enter a valid email.").nullable(),
  contactPhone: z
    .string()
    .regex(/^\+?[0-9\s-]{8,16}$/, "Enter a phone number with country code.")
    .nullable(),
  reportsEnabled: z.boolean(),
  /** Per-client Meta destination. Null falls back to the connector's default. */
  metaAdAccountId: z.string().nullable(),
  metaPageId: z.string().nullable(),
  metaPixelId: z.string().nullable(),
});

const reportSchema = z.object({
  action: z.literal("report"),
  clientId: z.string().min(1),
  /** Send it now, rather than waiting for Monday's cron. */
  send: z.boolean().default(false),
});

const schema = z.discriminatedUnion("action", [settingsSchema, reportSchema]);

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input." },
        { status: 400 },
      );
    }

    const input = parsed.data;

    if (input.action === "settings") {
      const member = await requirePermission("client:create");
      const client = await requireClient(member, input.clientId);

      await db.client.update({
        where: { id: client.id },
        data: {
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          reportsEnabled: input.reportsEnabled,
          metaAdAccountId: input.metaAdAccountId,
          metaPageId: input.metaPageId,
          metaPixelId: input.metaPixelId,
        },
      });

      return NextResponse.json({ ok: true });
    }

    const member = await requirePermission("report:send");
    const client = await requireClient(member, input.clientId);

    const report = await buildReport(client.id);
    const delivered = input.send ? await deliverReport(report.id) : null;

    return NextResponse.json({
      reportId: report.id,
      emailed: Boolean(delivered?.emailedAt),
      whatsapped: Boolean(delivered?.whatsappAt),
      note: delivered?.deliveryError ?? null,
    });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[clients]", error);
    return NextResponse.json({ error: "Could not update the client." }, { status: 500 });
  }
}
