import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, Palette, Share2, Users } from "lucide-react";

import { PageHeader } from "@/components/features/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { db } from "@/lib/db";
import { isFacebookConfigured } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PLAN_SPECS } from "@/lib/billing/plans";
import { ROLE_LABELS } from "@/lib/permissions";
import { getConnection } from "@/server/meta";
import { requireMember } from "@/server/tenant";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const member = await requireMember();

  const [user, agency, connection] = await Promise.all([
    db.user.findUnique({
      where: { id: member.userId },
      select: { name: true, email: true },
    }),
    db.agency.findUnique({
      where: { id: member.agencyId },
      select: { name: true, slug: true },
    }),
    getConnection(member.userId),
  ]);

  const connected = Boolean(connection?.adAccountId && connection?.pageId);

  const links = [
    {
      href: "/settings/meta",
      icon: Share2,
      title: "Meta",
      description: connected
        ? `Publishing via ${connection?.pageName ?? "your Page"}.`
        : isFacebookConfigured
          ? "Connect Facebook to publish campaigns."
          : "Add META_APP_ID and META_APP_SECRET to .env.",
      badge: connected ? "Connected" : "Not connected",
      allowed: true,
    },
    {
      href: "/settings/team",
      icon: Users,
      title: "Team",
      description: "Invite people and set what they can do.",
      allowed: can(member.role, "team:manage"),
    },
    {
      href: "/settings/billing",
      icon: CreditCard,
      title: "Billing",
      description: `${PLAN_SPECS[member.plan].name} plan.`,
      allowed: can(member.role, "billing:manage"),
    },
    {
      href: "/settings/branding",
      icon: Palette,
      title: "Branding",
      description: "Your logo and colour on client reports.",
      allowed: can(member.role, "branding:manage"),
    },
  ];

  return (
    <>
      <PageHeader title="Settings" description={agency?.name ?? "Your agency"} />

      <div className="grid max-w-2xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Row label="Name">{user?.name ?? "—"}</Row>
            <Separator />
            <Row label="Email">{user?.email}</Row>
            <Separator />
            <Row label="Role">{ROLE_LABELS[member.role]}</Row>
            <Separator />
            <Row label="Agency">{agency?.name}</Row>
          </CardContent>
        </Card>

        {links
          .filter((link) => link.allowed)
          .map((link) => (
            <Card key={link.href}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <link.icon className="text-muted-foreground size-4" aria-hidden />
                  <CardTitle>{link.title}</CardTitle>
                  {link.badge && (
                    <Badge variant={link.badge === "Connected" ? "default" : "secondary"}>
                      {link.badge}
                    </Badge>
                  )}
                </div>
                <CardDescription>{link.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline">
                  <Link href={link.href}>Manage</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}
