import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/features/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/db";
import { getInsights, type Insights } from "@/lib/meta/insights";
import { getConnection } from "@/server/meta";
import { requireMember } from "@/server/tenant";

export const metadata: Metadata = { title: "Reports" };

// Insights are fetched live from Meta on each load; don't cache the page.
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  clientName: string;
  status: string;
  insights: Insights | null;
  error?: string;
};

export default async function ReportsPage() {
  const member = await requireMember();

  const [campaigns, connection] = await Promise.all([
    db.campaign.findMany({
      where: { client: { agencyId: member.agencyId }, metaCampaignId: { not: null } },
      include: { client: true },
      orderBy: { createdAt: "desc" },
    }),
    getConnection(member.userId),
  ]);

  const rows: Row[] = await Promise.all(
    campaigns.map(async (campaign) => {
      const base = {
        id: campaign.id,
        name: campaign.name,
        clientName: campaign.client.name,
        status: campaign.status,
      };

      if (!connection?.accessToken) {
        return { ...base, insights: null, error: "Not connected" };
      }

      try {
        return {
          ...base,
          insights: await getInsights(
            connection.accessToken,
            campaign.metaCampaignId!,
            "last_7d",
          ),
        };
      } catch (error) {
        // One campaign failing to report shouldn't blank the whole page.
        return {
          ...base,
          insights: null,
          error: error instanceof Error ? error.message : "Could not load insights",
        };
      }
    }),
  );

  return (
    <>
      <PageHeader
        title="Reports"
        description="Live from Meta, last 7 days. A paused campaign correctly reads as zero."
      />

      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-8">
            <p className="text-muted-foreground text-sm">
              Nothing to report — no campaigns have been published to Meta yet.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/campaigns">Go to campaigns</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">CPC</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">CPL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{row.name}</span>
                        <Badge variant={row.status === "ACTIVE" ? "default" : "secondary"}>
                          {row.status}
                        </Badge>
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {row.error ?? row.clientName}
                      </span>
                    </TableCell>
                    <Metric value={row.insights && row.insights.spend.toFixed(2)} />
                    <Metric value={row.insights?.impressions.toLocaleString("en-IN")} />
                    <Metric value={row.insights?.clicks.toLocaleString("en-IN")} />
                    <Metric value={row.insights && `${row.insights.ctr.toFixed(2)}%`} />
                    <Metric value={row.insights && row.insights.cpc.toFixed(2)} />
                    <Metric value={row.insights?.leads.toLocaleString("en-IN")} />
                    <Metric
                      value={
                        row.insights?.cpl != null ? row.insights.cpl.toFixed(2) : row.insights && "—"
                      }
                    />
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

function Metric({ value }: { value: string | null | undefined }) {
  return (
    <TableCell className="text-right tabular-nums">
      {value ?? <span className="text-muted-foreground">—</span>}
    </TableCell>
  );
}
