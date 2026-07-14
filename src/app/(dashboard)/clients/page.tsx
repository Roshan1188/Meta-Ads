import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import { PageHeader } from "@/components/features/page-header";
import { ClientCard } from "@/components/features/clients/client-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getConnection, loadMetaOptions, type MetaOptions } from "@/server/meta";
import { requireMember } from "@/server/tenant";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const member = await requireMember();

  const [clients, connection] = await Promise.all([
    db.client.findMany({
      where: { agencyId: member.agencyId },
      include: {
        _count: { select: { campaigns: true } },
        reports: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    getConnection(member.userId),
  ]);

  let options: MetaOptions | null = null;
  if (connection?.accessToken) {
    // A dead token must not blank the page — the rest of it still works.
    options = await loadMetaOptions(
      connection.accessToken,
      connection.adAccountId,
    ).catch(() => null);
  }

  return (
    <>
      <PageHeader
        title="Clients"
        description="Where each client's ads go, and where their reports land."
        action={
          <Button asChild variant="outline">
            <Link href="/generate">
              <Sparkles className="size-4" />
              New client
            </Link>
          </Button>
        }
      />

      {clients.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-8">
            <p className="text-muted-foreground text-sm">
              No clients yet. Generating a campaign creates one automatically.
            </p>
            <Button asChild size="sm">
              <Link href="/generate">Generate</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {clients.map((client) => (
            <ClientCard
              key={client.id}
              options={options}
              canSendReports={can(member.role, "report:send")}
              client={{
                id: client.id,
                name: client.name,
                websiteUrl: client.websiteUrl,
                contactEmail: client.contactEmail,
                contactPhone: client.contactPhone,
                reportsEnabled: client.reportsEnabled,
                metaAdAccountId: client.metaAdAccountId,
                metaPageId: client.metaPageId,
                metaPixelId: client.metaPixelId,
                campaigns: client._count.campaigns,
                lastReportId: client.reports[0]?.id ?? null,
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
