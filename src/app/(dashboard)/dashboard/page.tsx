import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import { PageHeader } from "@/components/features/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/db";
import { formatRupees } from "@/lib/money";
import { PLAN_SPECS } from "@/lib/billing/plans";
import { requireMember } from "@/server/tenant";

export const metadata: Metadata = { title: "Dashboard" };

/** Cross-client analytics for the whole agency — the Phase 4 "one pane of glass". */
export default async function DashboardPage() {
  const member = await requireMember();

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const clients = await db.client.findMany({
    where: { agencyId: member.agencyId },
    include: {
      campaigns: {
        include: { metrics: { where: { date: { gte: since } } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = clients.map((client) => {
    const metrics = client.campaigns.flatMap((campaign) => campaign.metrics);

    const spend = sum(metrics.map((m) => m.spend));
    const clicks = sum(metrics.map((m) => m.clicks));
    const impressions = sum(metrics.map((m) => m.impressions));
    // Metric stores cost-per-lead, not lead count — recover the count from it.
    const leads = sum(metrics.map((m) => (m.cpl && m.cpl > 0 ? m.spend / m.cpl : 0)));

    return {
      id: client.id,
      name: client.name,
      autopilot: client.autopilot,
      live: client.campaigns.filter((campaign) => campaign.status === "ACTIVE").length,
      spend,
      clicks,
      impressions,
      leads: Math.round(leads),
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpl: leads > 0 ? spend / leads : null,
    };
  });

  const totals = {
    spend: sum(rows.map((row) => row.spend)),
    clicks: sum(rows.map((row) => row.clicks)),
    leads: sum(rows.map((row) => row.leads)),
    live: sum(rows.map((row) => row.live)),
  };

  const ranked = rows.filter((row) => row.spend > 0).sort((a, b) => cplRank(a) - cplRank(b));
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;

  const limit = PLAN_SPECS[member.plan].maxClients;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Every client, last 30 days. ${PLAN_SPECS[member.plan].name} plan — ${clients.length}${limit === null ? "" : ` of ${limit}`} client${clients.length === 1 ? "" : "s"}.`}
        action={
          <Button asChild>
            <Link href="/generate">
              <Sparkles className="size-4" />
              Generate
            </Link>
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Spend (30d)" value={formatRupees(totals.spend * 100)} />
        <Stat label="Clicks" value={totals.clicks.toLocaleString("en-IN")} />
        <Stat label="Leads" value={totals.leads.toLocaleString("en-IN")} />
        <Stat label="Live campaigns" value={String(totals.live)} />
      </div>

      {best && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">
                Best performer
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-medium">{best.name}</p>
              <p className="text-muted-foreground text-sm">
                {best.cpl ? `${formatRupees(best.cpl * 100)} per lead` : `${best.ctr.toFixed(2)}% CTR`}
              </p>
            </CardContent>
          </Card>

          {worst && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">
                  Needs attention
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-medium">{worst.name}</p>
                <p className="text-muted-foreground text-sm">
                  {worst.cpl
                    ? `${formatRupees(worst.cpl * 100)} per lead`
                    : `${worst.ctr.toFixed(2)}% CTR`}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {clients.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="text-muted-foreground py-10 text-sm">
            No clients yet. Generate your first campaign and this fills up.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Live</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">CPL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{row.name}</span>
                        {row.autopilot && <Badge variant="secondary">Auto-pilot</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.live}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRupees(row.spend * 100)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.clicks.toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.leads.toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.ctr.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.cpl ? formatRupees(row.cpl * 100) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Rank by cost per lead where we have one; fall back to inverted CTR. */
const cplRank = (row: { cpl: number | null; ctr: number }) =>
  row.cpl ?? (row.ctr > 0 ? 1_000 / row.ctr : Number.MAX_SAFE_INTEGER);
