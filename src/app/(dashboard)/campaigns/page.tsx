import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import { PageHeader } from "@/components/features/page-header";
import { CampaignActions } from "@/components/features/meta/campaign-actions";
import { PublishDialog } from "@/components/features/meta/publish-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatRupees } from "@/lib/money";
import { GOAL_LABELS, type Goal } from "@/lib/ai/schemas";
import { getConnection } from "@/server/meta";
import { requireMember } from "@/server/tenant";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const member = await requireMember();

  const [drafts, campaigns, connection] = await Promise.all([
    db.generationJob.findMany({
      where: { status: "DRAFT", client: { agencyId: member.agencyId } },
      include: { client: true },
      orderBy: { createdAt: "desc" },
    }),
    db.campaign.findMany({
      where: { client: { agencyId: member.agencyId } },
      include: { client: true, _count: { select: { adSets: true } } },
      orderBy: { createdAt: "desc" },
    }),
    getConnection(member.userId),
  ]);

  const connected = Boolean(connection?.adAccountId && connection?.pageId);

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Publish a draft to Meta, then activate it when you're ready to spend."
        action={
          <Button asChild variant="outline">
            <Link href="/generate">
              <Sparkles className="size-4" />
              New generation
            </Link>
          </Button>
        }
      />

      {!connected && (
        <Card className="mb-6 border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <p className="text-muted-foreground text-sm text-pretty">
              Connect Meta before publishing — we need an ad account and a Facebook Page.
            </p>
            <Button asChild size="sm">
              <Link href="/settings/meta">Connect Meta</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium">Drafts</h2>

        {drafts.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="text-muted-foreground py-8 text-sm">
              No drafts yet. Generate one and it&apos;ll show up here.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {drafts.map((draft) => (
              <Card key={draft.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
                  <div>
                    <p className="font-medium">{draft.client.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {GOAL_LABELS[draft.goal as Goal]} ·{" "}
                      {formatRupees(draft.budgetPerDay)}/day ·{" "}
                      {(draft.images as string[] | null)?.length ?? 0} images
                    </p>
                  </div>

                  {connected ? (
                    <PublishDialog
                      jobId={draft.id}
                      clientName={draft.client.name}
                      dailyBudget={draft.budgetPerDay}
                    />
                  ) : (
                    <Button size="sm" disabled title="Connect Meta first">
                      Publish
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium">Published</h2>

        {campaigns.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="text-muted-foreground py-8 text-sm">
              Nothing published yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {campaigns.map((campaign) => (
              <Card key={campaign.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">{campaign.name}</CardTitle>
                    <Badge variant={campaign.status === "ACTIVE" ? "default" : "secondary"}>
                      {campaign.status}
                    </Badge>
                  </div>
                  <CardDescription>
                    {campaign.client.name} · {campaign._count.adSets} ad sets ·{" "}
                    {formatRupees(campaign.dailyBudget)}/day
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center justify-between gap-4">
                  <code className="text-muted-foreground text-xs">
                    {campaign.metaCampaignId}
                  </code>
                  <CampaignActions
                    campaignId={campaign.id}
                    status={campaign.status}
                    dailyBudget={campaign.dailyBudget}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
