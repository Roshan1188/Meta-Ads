import { NextResponse } from "next/server";
import type { z } from "zod";

import { ScrapeError } from "@/lib/ai/scrape";
import { GenerationError } from "@/server/generate";
import { AccessError, requirePermission, type Member } from "@/server/tenant";

/**
 * Wraps a generation route: authenticate, check the caller's role and plan, validate
 * the body, run, and turn any throw into a message a user can act on. AI and scrape
 * failures are expected conditions here, not 500s.
 */
export function generationRoute<TSchema extends z.ZodType>(
  schema: TSchema,
  run: (input: z.infer<TSchema>, member: Member) => Promise<unknown>,
) {
  return async (req: Request) => {
    let member: Member;
    try {
      member = await requirePermission("client:generate");
    } catch (error) {
      const access = error as AccessError;
      return NextResponse.json({ error: access.message }, { status: access.status ?? 403 });
    }

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input." },
        { status: 400 },
      );
    }

    try {
      return NextResponse.json(await run(parsed.data, member));
    } catch (error) {
      if (error instanceof AccessError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      if (error instanceof GenerationError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      if (error instanceof ScrapeError) {
        return NextResponse.json({ error: error.message }, { status: 422 });
      }

      console.error("[generate]", error);
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Something went wrong during generation.",
        },
        { status: 500 },
      );
    }
  };
}
