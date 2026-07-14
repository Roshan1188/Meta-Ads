import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/features/page-header";
import { AutopilotCard } from "@/components/features/optimize/autopilot-card";
import { Timeline } from "@/components/features/optimize/timeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requireMember } from "@/server/tenant";
import { DEFAULT_RULES } from "@/lib/optimize/rules";

export const metadata: Metadata = { title: "Automation" };

export default async function AutomationPage() {
  const member = await requireMember();

  const [clients, logs] = await Promise.all([
    db.client.findMany({
      where: { agencyId: member.agencyId },
      include: {
        _count: { select: { campaigns: true } },
        campaigns: { where: { status: "ACTIVE" }, select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.optimizationLog.findMany({
      where: { client: { agencyId: member.agencyId } },
      include: { client: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Automation"
        description={`Winners get more budget, losers get paused. Rules: raise at ${DEFAULT_RULES.winnerCtrPct}% CTR, pause below ${DEFAULT_RULES.loserCtrPct}% after ${DEFAULT_RULES.minImpressions.toLocaleString("en-IN")} impressions, budget moves capped at ${DEFAULT_RULES.maxBudgetStepPct}% a day.`}
      />

      {clients.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-8">
            <p className="text-muted-foreground text-sm">
              No clients yet. Generate a campaign first.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/generate">Generate</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="mb-10 grid gap-4 lg:grid-cols-2">
            {clients.map((client) => (
              <AutopilotCard
                key={client.id}
                clientId={client.id}
                clientName={client.name}
                autopilot={client.autopilot}
                requireApproval={client.requireApproval}
                maxDailyBudget={client.maxDailyBudget}
                activeCampaigns={client.campaigns.length}
              />
            ))}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium">Timeline</h2>
            <Timeline
              entries={logs.map((log) => ({
                id: log.id,
                action: log.action,
                reason: log.reason,
                status: log.status,
                error: log.error,
                clientName: log.client.name,
                createdAt: log.createdAt.toISOString(),
              }))}
            />
          </section>
        </>
      )}
    </>
  );
}
