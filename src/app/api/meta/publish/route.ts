import { z } from "zod";

import { publishDraft } from "@/server/publish";
import { AccessError, requirePermission, type Member } from "@/server/tenant";

// Creating a campaign, several ad sets, ten image uploads, and their ads is slow.
export const maxDuration = 300;

const schema = z.object({ jobId: z.string().min(1) });

/**
 * Streams the publish log as newline-delimited JSON. A plain JSON response would
 * leave the user staring at a spinner for two minutes with no idea which step is
 * running — or which one failed.
 */
export async function POST(req: Request) {
  let member: Member;
  try {
    // An EMPLOYEE can draft all day, but publishing spends money.
    member = await requirePermission("campaign:publish");
  } catch (error) {
    const access = error as AccessError;
    return Response.json({ error: access.message }, { status: access.status ?? 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid input." }, { status: 400 });
  }

  const { jobId } = parsed.data;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of publishDraft(member, jobId)) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (error) {
        console.error("[meta/publish]", error);
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ type: "error", message: "Publishing stopped unexpectedly." })}\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Without this, a proxy may buffer the whole stream and defeat the point.
      "X-Accel-Buffering": "no",
    },
  });
}
