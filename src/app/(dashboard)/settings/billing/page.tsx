import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/features/page-header";
import { PlanPicker } from "@/components/features/billing/plan-picker";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { isRazorpayConfigured } from "@/lib/billing/razorpay";
import { requireMember } from "@/server/tenant";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage() {
  const member = await requireMember();
  if (!can(member.role, "billing:manage")) redirect("/settings");

  const [subscription, clients, campaigns] = await Promise.all([
    db.subscription.findUnique({ where: { agencyId: member.agencyId } }),
    db.client.count({ where: { agencyId: member.agencyId } }),
    db.campaign.count({ where: { client: { agencyId: member.agencyId } } }),
  ]);

  return (
    <>
      <PageHeader
        title="Billing"
        description={`Currently using ${clients} client${clients === 1 ? "" : "s"} and ${campaigns} campaign${campaigns === 1 ? "" : "s"}.`}
      />
      <PlanPicker
        current={member.plan}
        status={subscription?.status ?? "active"}
        configured={isRazorpayConfigured}
        periodEnd={subscription?.currentPeriodEnd?.toISOString() ?? null}
      />
    </>
  );
}
